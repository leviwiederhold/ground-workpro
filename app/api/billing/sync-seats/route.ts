import { requireRole } from "@/lib/auth/requireRole";
import { isStripeConfigured } from "@/lib/billing/stripe";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { syncStripeQuantityForCompany } from "@/lib/billing/syncStripeQuantity";
import { errorResponse } from "@/lib/http/errorResponse";
import { enforceRateLimit } from "@/lib/http/rateLimit";

export const runtime = "nodejs";

function isNativeRequest(request: Request): boolean {
  const nativeHeader = request.headers.get("x-groundwork-native");
  const platformHeader = request.headers.get("x-groundwork-platform");
  const userAgent = request.headers.get("user-agent") ?? "";
  return (
    nativeHeader === "1" ||
    String(platformHeader ?? "").toLowerCase() === "ios" ||
    /Capacitor|GroundworkProNative/i.test(userAgent)
  );
}

/**
 * POST /api/billing/sync-seats
 *
 * Reconciles the company's Stripe subscription item quantity with the current
 * active billable seat count. Self-heals drift (e.g. seats added while no
 * subscription existed, or a sync that failed earlier). One company = one
 * subscription; only the item quantity is updated — no new subscriptions,
 * products, or customers are created.
 *
 * Web CEO/admin only. Native app is blocked (no billing UI on native).
 */
export async function POST(request: Request) {
  const rateLimited = enforceRateLimit(request, {
    keyPrefix: "billing-sync-seats",
    limit: 30,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  try {
    if (isNativeRequest(request)) {
      return errorResponse("Not available in the native app", 403);
    }

    try {
      await requireRole(["admin"]);
    } catch {
      return errorResponse("You don't have permission to manage billing.", 403);
    }

    if (!isStripeConfigured()) {
      return errorResponse("Billing is not configured", 501);
    }

    const { companyId } = await getCompanyId();

    const result = await syncStripeQuantityForCompany(companyId);
    if (!result.synced) {
      // Non-fatal reasons (no subscription yet, etc.) — report without error so
      // the billing page can simply show current state.
      console.warn("[billing/sync-seats] not synced:", result.reason);
      return Response.json({ ok: true, synced: false, reason: result.reason });
    }

    return Response.json({ ok: true, synced: true, quantity: result.quantity });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return errorResponse(error.message, error.status);
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[billing/sync-seats] unexpected error:", message);
    return errorResponse("We couldn't update your seat count. Please try again.", 500);
  }
}
