import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getCompanyBillingStatus } from "@/lib/billing/isCompanySubscriptionActive";
import { errorResponse } from "@/lib/http/errorResponse";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { okItem } from "@/lib/http/json";
import { serverError } from "@/lib/http/errors";

export async function GET(request: Request) {
  const rateLimited = enforceRateLimit(request, {
    keyPrefix: "billing-status",
    limit: 120,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  try {
    const { supabase, companyId } = await getCompanyId();
    const status = await getCompanyBillingStatus(supabase, companyId);

    return okItem(status);
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return errorResponse(error.message, error.status);
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return serverError(message);
  }
}
