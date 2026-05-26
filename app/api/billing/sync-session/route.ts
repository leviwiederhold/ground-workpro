import { getStripe } from "@/lib/billing/stripe";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
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
    console.log("[sync-session] Retrieving Stripe session:", sessionId);
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription"],
    });
    console.log("[sync-session] Session retrieved — mode:", session.mode, "status:", session.status, "metadata:", JSON.stringify(session.metadata));

    // Only handle subscription checkouts that have completed.
    if (session.mode !== "subscription" || session.status !== "complete") {
      console.warn("[sync-session] Session not in expected state — mode:", session.mode, "status:", session.status);
      return Response.json({ ok: true, synced: false, reason: "session_not_complete" });
    }

    const companyId = String(session.metadata?.company_id ?? "").trim();
    console.log("[sync-session] company_id from metadata:", companyId || "(empty)");
    if (!companyId) {
      return Response.json({ ok: true, synced: false, reason: "no_company_id_in_metadata" });
    }

    const subscription =
      typeof session.subscription === "string"
        ? await stripe.subscriptions.retrieve(session.subscription)
        : session.subscription;

    console.log("[sync-session] Subscription id:", subscription?.id, "status:", subscription?.status);
    if (!subscription) {
      return Response.json({ ok: true, synced: false, reason: "no_subscription" });
    }

    const admin = getSupabaseAdmin();
    console.log("[sync-session] Admin client available:", !!admin);
    if (!admin) {
      // No service-role key configured — fall back to webhook sync.
      return Response.json({ ok: true, synced: false, reason: "admin_not_configured" });
    }

    const updatePayload = {
      stripe_customer_id: idFromRef(session.customer) || undefined,
      stripe_subscription_id: subscription.id,
      subscription_status: subscription.status,
      plan_type: "groundwork_pro",
      trial_ends_at: unixToIso(subscription.trial_end),
      current_period_end: unixToIso(subscription.items.data[0]?.current_period_end),
    };
    console.log("[sync-session] Updating companies row — id:", companyId, "payload:", JSON.stringify(updatePayload));

    let { error } = await admin
      .from("companies")
      .update(updatePayload)
      .eq("id", companyId);

    // If plan_type violates a check constraint, retry without it so the
    // critical billing fields (subscription_status, stripe IDs) still land.
    if (error?.code === "23514" && error.message?.includes("plan_type")) {
      console.warn("[sync-session] plan_type check constraint hit — retrying without plan_type. Run migration to drop companies_plan_type_check.");
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { plan_type: _dropped, ...payloadWithoutPlanType } = updatePayload;
      const retry = await admin
        .from("companies")
        .update(payloadWithoutPlanType)
        .eq("id", companyId);
      error = retry.error;
    }

    if (error) {
      console.error("[sync-session] DB update failed:", error.message, error);
      return Response.json({ ok: true, synced: false, reason: "db_error", detail: error.message });
    }

    // Verify the write landed
    const { data: verify, error: verifyErr } = await admin
      .from("companies")
      .select("id, subscription_status, plan_type")
      .eq("id", companyId)
      .maybeSingle();
    console.log("[sync-session] Post-update verify — data:", JSON.stringify(verify), "err:", verifyErr?.message);

    return Response.json({ ok: true, synced: true, status: subscription.status });
  } catch (err) {
    console.error("[sync-session] Unexpected error:", err instanceof Error ? err.message : err);
    return Response.json({ ok: true, synced: false, reason: "unexpected_error", detail: err instanceof Error ? err.message : String(err) });
  }
}
