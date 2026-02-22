import { requireRole } from "@/lib/auth/requireRole";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { forbidden, notFound, serverError } from "@/lib/http/errors";
import { okSuccess } from "@/lib/http/json";

export const dynamic = "force-dynamic";

function toTenantErrorResponse(error: TenantResolverError) {
  if (error.status === 404) return notFound(error.message);
  if (error.status === 403) return forbidden(error.message);
  return serverError(error.message);
}

export async function POST() {
  try {
    try {
      await requireRole(["admin"]);
    } catch {
      return forbidden();
    }

    const { supabase, companyId } = await getCompanyId();
    const { error } = await supabase
      .from("onboarding_checklist")
      .delete()
      .eq("company_id", companyId);

    if (error) {
      return serverError(error.message);
    }

    return okSuccess();
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return toTenantErrorResponse(error);
    }
    return serverError();
  }
}
