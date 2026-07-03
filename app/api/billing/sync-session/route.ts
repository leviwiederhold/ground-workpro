import { getStripe } from "@/lib/billing/stripe";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { errorResponse } from "@/lib/http/errorResponse";

export const runtime = "nodejs";

function unixToIso(value: number | null | undefined) {
  return typeof value === "number" ? new Date(value * 1000).toISOString() : null;
}

function idFromRef(value: string | { id?: string } | null | undefined): string {
  if (!value) return "";
  return typeof value === "string" ? value : String(value.id ?? "");
}

function isSubscriptionAccessReady(status: string | null | undefined) {
  return status === "trialing" || status === "active";
}

function logSyncDiagnostic(
  level: "log" | "warn" | "error",
  message: string,
  details: Record<string, unknown>
) {
  console[level]("[sync-session]", message, details);
}

/**
 * Syncs a completed Stripe checkout session into the company billing record.
 *
 * Intentionally does NOT use user-auth cookies for the DB write — after a Stripe
 * redirect the server-side SSR cookie may not be refreshed yet. Instead we
 * authenticate the request via the Stripe API itself (retrieve the session using
 * our secret key) and trust metadata.company_id, which our server wrote when
 * creating the session. The write uses the Supabase admin client, matching the
 * pattern used by the Stripe webhook handler.
 */
export async function POST(request: Request) {
  const rateLimited = enforceRateLimit(request, {
    keyPrefix: "billing-sync-session",
    limit: 20,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    return Response.json({ ok: true, synced: false, reason: "stripe_not_configured" });
  }

  let sessionId: string;
  try {
    const body = (await request.json().catch(() => ({}))) as { sessionId?: unknown };
    const raw = String(body?.sessionId ?? "").trim();
    if (!raw) return errorResponse("sessionId is required", 400);
    sessionId = raw;
  } catch {
    return errorResponse("Invalid request body", 400);
  }

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription"],
    });
    const companyId = String(session.metadata?.company_id ?? "").trim();
    const stripeCustomerId = idFromRef(session.customer);
    const subscription =
      typeof session.subscription === "string"
        ? await stripe.subscriptions.retrieve(session.subscription)
        : session.subscription;
    const stripeSubscriptionId = subscription?.id ?? "";
    const stripeSubscriptionStatus = String(subscription?.status ?? "").trim().toLowerCase();

    const supabase = await supabaseServer();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    const localUserId = userData?.user?.id ?? null;
    const localUserEmail = String(userData?.user?.email ?? "").trim().toLowerCase() || null;

    logSyncDiagnostic("log", "checkout session retrieved", {
      session_id: sessionId,
      stripe_customer_id: stripeCustomerId || null,
      stripe_subscription_id: stripeSubscriptionId || null,
      stripe_subscription_status: stripeSubscriptionStatus || null,
      local_user_id: localUserId,
      local_company_id: companyId || null,
      session_mode: session.mode,
      session_status: session.status,
      denial_or_retry_reason: null,
    });

    // Only handle subscription checkouts that have completed.
    if (session.mode !== "subscription" || session.status !== "complete") {
      logSyncDiagnostic("warn", "session not complete", {
        session_id: sessionId,
        stripe_customer_id: stripeCustomerId || null,
        stripe_subscription_id: stripeSubscriptionId || null,
        stripe_subscription_status: stripeSubscriptionStatus || null,
        local_user_id: localUserId,
        local_company_id: companyId || null,
        denial_or_retry_reason: "session_not_complete",
      });
      return Response.json({ ok: true, synced: false, reason: "session_not_complete" });
    }

    if (!companyId) {
      logSyncDiagnostic("warn", "missing company metadata", {
        session_id: sessionId,
        stripe_customer_id: stripeCustomerId || null,
        stripe_subscription_id: stripeSubscriptionId || null,
        stripe_subscription_status: stripeSubscriptionStatus || null,
        local_user_id: localUserId,
        local_company_id: null,
        denial_or_retry_reason: "no_company_id_in_metadata",
      });
      return Response.json({ ok: true, synced: false, reason: "no_company_id_in_metadata" });
    }

    if (!subscription) {
      logSyncDiagnostic("warn", "missing subscription", {
        session_id: sessionId,
        stripe_customer_id: stripeCustomerId || null,
        stripe_subscription_id: null,
        stripe_subscription_status: null,
        local_user_id: localUserId,
        local_company_id: companyId,
        denial_or_retry_reason: "no_subscription",
      });
      return Response.json({ ok: true, synced: false, reason: "no_subscription" });
    }

    const admin = getSupabaseAdmin();
    if (!admin) {
      // No service-role key configured — fall back to webhook sync.
      logSyncDiagnostic("warn", "admin client unavailable", {
        session_id: sessionId,
        stripe_customer_id: stripeCustomerId || null,
        stripe_subscription_id: stripeSubscriptionId,
        stripe_subscription_status: stripeSubscriptionStatus,
        local_user_id: localUserId,
        local_company_id: companyId,
        denial_or_retry_reason: "admin_not_configured",
      });
      return Response.json({ ok: true, synced: false, reason: "admin_not_configured" });
    }

    if (userError || !localUserId) {
      logSyncDiagnostic("warn", "not authenticated", {
        session_id: sessionId,
        stripe_customer_id: stripeCustomerId || null,
        stripe_subscription_id: stripeSubscriptionId,
        stripe_subscription_status: stripeSubscriptionStatus,
        local_user_id: null,
        local_company_id: companyId,
        denial_or_retry_reason: "not_authenticated",
      });
      return Response.json({ ok: true, synced: false, reason: "not_authenticated" });
    }

    const { data: membership, error: membershipError } = await admin
      .from("memberships")
      .select("company_id")
      .eq("user_id", localUserId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (membershipError) {
      logSyncDiagnostic("error", "membership lookup failed", {
        session_id: sessionId,
        stripe_customer_id: stripeCustomerId || null,
        stripe_subscription_id: stripeSubscriptionId,
        stripe_subscription_status: stripeSubscriptionStatus,
        local_user_id: localUserId,
        local_user_email: localUserEmail,
        local_company_id: companyId,
        denial_or_retry_reason: "membership_lookup_failed",
        detail: membershipError.message,
      });
      return Response.json({ ok: true, synced: false, reason: "membership_lookup_failed", detail: membershipError.message });
    }

    if (!membership?.company_id) {
      logSyncDiagnostic("warn", "user is not a member of checkout company", {
        session_id: sessionId,
        stripe_customer_id: stripeCustomerId || null,
        stripe_subscription_id: stripeSubscriptionId,
        stripe_subscription_status: stripeSubscriptionStatus,
        local_user_id: localUserId,
        local_user_email: localUserEmail,
        local_company_id: companyId,
        denial_or_retry_reason: "user_not_member_of_session_company",
      });
      return Response.json({ ok: true, synced: false, reason: "user_not_member_of_session_company" });
    }

    const { data: company, error: companyError } = await admin
      .from("companies")
      .select("id, stripe_customer_id, stripe_subscription_id, subscription_status")
      .eq("id", companyId)
      .maybeSingle();

    if (companyError) {
      logSyncDiagnostic("error", "company lookup failed", {
        session_id: sessionId,
        stripe_customer_id: stripeCustomerId || null,
        stripe_subscription_id: stripeSubscriptionId,
        stripe_subscription_status: stripeSubscriptionStatus,
        local_user_id: localUserId,
        local_company_id: companyId,
        existing_company_stripe_customer_id: null,
        denial_or_retry_reason: "company_lookup_failed",
        detail: companyError.message,
      });
      return Response.json({ ok: true, synced: false, reason: "company_lookup_failed", detail: companyError.message });
    }

    if (!company?.id) {
      logSyncDiagnostic("warn", "company not found", {
        session_id: sessionId,
        stripe_customer_id: stripeCustomerId || null,
        stripe_subscription_id: stripeSubscriptionId,
        stripe_subscription_status: stripeSubscriptionStatus,
        local_user_id: localUserId,
        local_company_id: companyId,
        existing_company_stripe_customer_id: null,
        denial_or_retry_reason: "company_not_found",
      });
      return Response.json({ ok: true, synced: false, reason: "company_not_found" });
    }

    const existingCompanyStripeCustomerId = String(company.stripe_customer_id ?? "").trim();
    if (
      existingCompanyStripeCustomerId &&
      stripeCustomerId &&
      existingCompanyStripeCustomerId !== stripeCustomerId
    ) {
      logSyncDiagnostic("warn", "stripe customer mismatch", {
        session_id: sessionId,
        stripe_customer_id: stripeCustomerId,
        stripe_subscription_id: stripeSubscriptionId,
        stripe_subscription_status: stripeSubscriptionStatus,
        local_user_id: localUserId,
        local_company_id: companyId,
        existing_company_stripe_customer_id: existingCompanyStripeCustomerId,
        denial_or_retry_reason: "stripe_customer_mismatch",
      });
      return Response.json({ ok: true, synced: false, reason: "stripe_customer_mismatch" });
    }

    if (!isSubscriptionAccessReady(stripeSubscriptionStatus)) {
      logSyncDiagnostic("warn", "subscription not active or trialing", {
        session_id: sessionId,
        stripe_customer_id: stripeCustomerId || null,
        stripe_subscription_id: stripeSubscriptionId,
        stripe_subscription_status: stripeSubscriptionStatus,
        local_user_id: localUserId,
        local_company_id: companyId,
        existing_company_stripe_customer_id: existingCompanyStripeCustomerId || null,
        denial_or_retry_reason: "subscription_not_ready",
      });
      return Response.json({ ok: true, synced: false, reason: "subscription_not_ready", status: stripeSubscriptionStatus });
    }

    const updatePayload = {
      stripe_customer_id: stripeCustomerId || undefined,
      stripe_subscription_id: subscription.id,
      subscription_status: subscription.status,
      plan_type: "groundwork_pro",
      trial_ends_at: unixToIso(subscription.trial_end),
      current_period_end: unixToIso(subscription.items.data[0]?.current_period_end),
    };
    logSyncDiagnostic("log", "updating company billing state", {
      session_id: sessionId,
      stripe_customer_id: stripeCustomerId || null,
      stripe_subscription_id: stripeSubscriptionId,
      stripe_subscription_status: stripeSubscriptionStatus,
      local_user_id: localUserId,
      local_company_id: companyId,
      existing_company_stripe_customer_id: existingCompanyStripeCustomerId || null,
      denial_or_retry_reason: null,
    });

    let { error } = await admin
      .from("companies")
      .update(updatePayload)
      .eq("id", companyId);

    // If plan_type violates a check constraint, retry without it so the
    // critical billing fields (subscription_status, stripe IDs) still land.
    if (error?.code === "23514" && error.message?.includes("plan_type")) {
      logSyncDiagnostic("warn", "plan_type check constraint hit; retrying without plan_type", {
        session_id: sessionId,
        stripe_customer_id: stripeCustomerId || null,
        stripe_subscription_id: stripeSubscriptionId,
        stripe_subscription_status: stripeSubscriptionStatus,
        local_user_id: localUserId,
        local_company_id: companyId,
        existing_company_stripe_customer_id: existingCompanyStripeCustomerId || null,
        denial_or_retry_reason: "plan_type_constraint_retry",
      });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { plan_type: _dropped, ...payloadWithoutPlanType } = updatePayload;
      const retry = await admin
        .from("companies")
        .update(payloadWithoutPlanType)
        .eq("id", companyId);
      error = retry.error;
    }

    if (error) {
      logSyncDiagnostic("error", "db update failed", {
        session_id: sessionId,
        stripe_customer_id: stripeCustomerId || null,
        stripe_subscription_id: stripeSubscriptionId,
        stripe_subscription_status: stripeSubscriptionStatus,
        local_user_id: localUserId,
        local_company_id: companyId,
        existing_company_stripe_customer_id: existingCompanyStripeCustomerId || null,
        denial_or_retry_reason: "db_error",
        detail: error.message,
      });
      return Response.json({ ok: true, synced: false, reason: "db_error", detail: error.message });
    }

    // Verify the write landed
    const { data: verify, error: verifyErr } = await admin
      .from("companies")
      .select("id, stripe_customer_id, stripe_subscription_id, subscription_status, plan_type, trial_ends_at, current_period_end")
      .eq("id", companyId)
      .maybeSingle();
    logSyncDiagnostic(verifyErr ? "warn" : "log", "post-update verification", {
      session_id: sessionId,
      stripe_customer_id: stripeCustomerId || null,
      stripe_subscription_id: stripeSubscriptionId,
      stripe_subscription_status: stripeSubscriptionStatus,
      local_user_id: localUserId,
      local_company_id: companyId,
      existing_company_stripe_customer_id: existingCompanyStripeCustomerId || null,
      verified_company: verify ?? null,
      denial_or_retry_reason: verifyErr ? "verify_failed" : null,
      detail: verifyErr?.message,
    });

    return Response.json({
      ok: true,
      synced: true,
      status: subscription.status,
      companyId,
      customerId: stripeCustomerId,
      subscriptionId: stripeSubscriptionId,
      active: isSubscriptionAccessReady(stripeSubscriptionStatus),
    });
  } catch (err) {
    logSyncDiagnostic("error", "unexpected error", {
      session_id: sessionId,
      denial_or_retry_reason: "unexpected_error",
      detail: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ ok: true, synced: false, reason: "unexpected_error", detail: err instanceof Error ? err.message : String(err) });
  }
}
