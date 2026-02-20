import { requireRole } from "@/lib/auth/requireRole";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getCompanyBillingSnapshot } from "@/lib/billing/subscription";
import { isStripeConfigured } from "@/lib/billing/stripe";
import { errorResponse } from "@/lib/http/errorResponse";
import { enforceRateLimit } from "@/lib/http/rateLimit";

export async function GET(request: Request) {
  const rateLimited = enforceRateLimit(request, {
    keyPrefix: "billing-get",
    limit: 120,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  try {
    try {
      await requireRole(["admin"]);
    } catch {
      return errorResponse("Forbidden", 403);
    }

    if (!isStripeConfigured()) {
      return errorResponse("Stripe not configured", 501);
    }

    const { supabase, companyId } = await getCompanyId();
    const billing = await getCompanyBillingSnapshot(supabase, companyId);

    return Response.json({
      item: {
        plan_type: billing.planType,
        subscription_status: billing.subscriptionStatus,
      },
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return errorResponse(error.message, error.status);
    }
    const message = error instanceof Error ? error.message : "Unexpected server error";
    return errorResponse(message, 500);
  }
}
