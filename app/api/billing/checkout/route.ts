import { requireRole } from "@/lib/auth/requireRole";
import { isBillingEnabled } from "@/lib/billing/isBillingEnabled";
import { isStripeConfigured } from "@/lib/billing/isStripeConfigured";
import { errorResponse } from "@/lib/http/errorResponse";
import { enforceRateLimit } from "@/lib/http/rateLimit";

export async function POST(request: Request) {
  const rateLimited = enforceRateLimit(request, {
    keyPrefix: "billing-checkout",
    limit: 60,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  try {
    try {
      await requireRole(["admin"]);
    } catch {
      return errorResponse("Forbidden", 403);
    }

    if (!isBillingEnabled()) {
      return errorResponse("Billing not enabled", 501);
    }

    if (!isStripeConfigured()) {
      return errorResponse("Stripe not configured", 501);
    }

    return errorResponse("Not implemented", 501);
  } catch {
    return errorResponse("Internal server error", 500);
  }
}
