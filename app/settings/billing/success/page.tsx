'use server';

import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { getStripe } from "@/lib/billing/stripe";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getOptionalCompanyId } from "@/lib/tenant/getCompanyId";
import { getSetupStatusForUser } from "@/lib/onboarding/setupFlow";

function unixToIso(value: number | null | undefined) {
  return typeof value === "number" ? new Date(value * 1000).toISOString() : null;
}

function idFromRef(value: string | { id?: string } | null | undefined): string {
  if (!value) return "";
  return typeof value === "string" ? value : String(value.id ?? "");
}

async function syncCheckoutSession(sessionId: string) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return { synced: false, active: false, reason: "stripe_not_configured" };
  }

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["subscription"],
  });

  if (session.mode !== "subscription" || session.status !== "complete") {
    return { synced: false, active: false, reason: "session_not_complete" };
  }

  const companyId = String(session.metadata?.company_id ?? "").trim();
  if (!companyId) {
    return { synced: false, active: false, reason: "no_company_id_in_metadata" };
  }

  const subscription =
    typeof session.subscription === "string"
      ? await stripe.subscriptions.retrieve(session.subscription)
      : session.subscription;

  if (!subscription) {
    return { synced: false, active: false, reason: "no_subscription" };
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return { synced: false, active: subscription.status === "active" || subscription.status === "trialing", reason: "admin_not_configured" };
  }

  const updatePayload = {
    stripe_customer_id: idFromRef(session.customer) || undefined,
    stripe_subscription_id: subscription.id,
    subscription_status: subscription.status,
    plan_type: "groundwork_pro",
    trial_ends_at: unixToIso(subscription.trial_end),
    current_period_end: unixToIso(subscription.items.data[0]?.current_period_end),
  };

  let { error } = await admin
    .from("companies")
    .update(updatePayload)
    .eq("id", companyId);

  if (error?.code === "23514" && error.message?.includes("plan_type")) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { plan_type: _dropped, ...payloadWithoutPlanType } = updatePayload;
    const retry = await admin
      .from("companies")
      .update(payloadWithoutPlanType)
      .eq("id", companyId);
    error = retry.error;
  }

  if (error) {
    console.error("[billing/success] DB update failed:", error.message);
    return { synced: false, active: false, reason: "db_error" };
  }

  return {
    synced: true,
    active: subscription.status === "active" || subscription.status === "trialing",
    reason: subscription.status,
  };
}

interface PageProps {
  searchParams: Promise<{ session_id?: string }>;
}

export default async function BillingSuccessPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const sessionId = params.session_id;

  const supabase = await supabaseServer();
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect("/login");
  }

  if (sessionId) {
    const syncResult = await syncCheckoutSession(sessionId);
    console.log("[billing/success] checkout sync result", syncResult);
    if (!syncResult.active) {
      redirect("/");
    }
  }

  let setupComplete = false;
  try {
    const { supabase: tenantSupabase, companyId, userId, userEmail } = await getOptionalCompanyId();
    const status = await getSetupStatusForUser({
      supabase: tenantSupabase,
      companyId,
      userId,
      userEmail,
    });
    setupComplete = Boolean(status.is_complete);
  } catch (error) {
    console.warn("[billing/success] setup status check failed:", error);
  }

  redirect(setupComplete ? "/" : "/setup?trial=started");
}
