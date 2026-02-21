import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { okItems } from "@/lib/http/json";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { isMissingBgJobsSchema, listBgJobsDlqFallback } from "@/lib/bg-jobs/fallbackStore";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

type ValidationIssue = {
  path: Array<string | number>;
  message: string;
};

function toValidationDetails(error: { issues: ValidationIssue[] }) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

function toTenantErrorResponse(error: TenantResolverError) {
  if (error.status === 404) return notFound(error.message);
  if (error.status === 403) return forbidden(error.message);
  return serverError(error.message);
}

export async function GET(request: Request) {
  try {
    try {
      await requireRole(["admin", "pm"]);
    } catch {
      return forbidden();
    }

    const { supabase, companyId } = await getCompanyId();
    const url = new URL(request.url);
    const parsedQuery = querySchema.safeParse({
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsedQuery.success) {
      return validationError(toValidationDetails(parsedQuery.error));
    }

    const { data, error } = await supabase
      .from("bg_jobs_dlq")
      .select("id, bg_job_id, type, company_id, payload, attempts, last_error, failed_at")
      .eq("company_id", companyId)
      .order("failed_at", { ascending: false })
      .limit(parsedQuery.data.limit);

    if (error) {
      if (isMissingBgJobsSchema(error.message || "")) {
        return okItems(listBgJobsDlqFallback(companyId, parsedQuery.data.limit));
      }
      return serverError();
    }

    return okItems(Array.isArray(data) ? data : []);
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return toTenantErrorResponse(error);
    }
    return serverError();
  }
}
