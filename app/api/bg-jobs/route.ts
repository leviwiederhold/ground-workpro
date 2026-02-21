import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { okItem, okItems } from "@/lib/http/json";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { bgJobStatusSchema, enqueueBgJobSchema } from "@/lib/bg-jobs/queue";
import {
  enqueueBgJobFallback,
  isMissingBgJobsSchema,
  listBgJobsFallback,
} from "@/lib/bg-jobs/fallbackStore";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  status: bgJobStatusSchema.optional(),
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
    const { supabase, companyId } = await getCompanyId();
    const url = new URL(request.url);
    const parsedQuery = querySchema.safeParse({
      status: url.searchParams.get("status") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsedQuery.success) {
      return validationError(toValidationDetails(parsedQuery.error));
    }

    let query = supabase
      .from("bg_jobs")
      .select("id, type, company_id, payload, status, run_at, attempts, max_attempts, last_error, created_at, updated_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(parsedQuery.data.limit);

    if (parsedQuery.data.status) {
      query = query.eq("status", parsedQuery.data.status);
    }

    const { data, error } = await query;
    if (error) {
      if (isMissingBgJobsSchema(error.message || "")) {
        return okItems(listBgJobsFallback(companyId, parsedQuery.data.limit, parsedQuery.data.status));
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

export async function POST(request: Request) {
  try {
    try {
      await requireRole(["admin", "pm"]);
    } catch {
      return forbidden();
    }

    const payload = await request.json().catch(() => null);
    const parsedBody = enqueueBgJobSchema.safeParse(payload);
    if (!parsedBody.success) {
      return validationError(toValidationDetails(parsedBody.error));
    }

    const { supabase, companyId } = await getCompanyId();
    const nowIso = new Date().toISOString();

    const insertPayload = {
      type: parsedBody.data.type,
      company_id: companyId,
      payload: parsedBody.data.payload,
      status: "queued",
      run_at: parsedBody.data.run_at ?? nowIso,
      attempts: 0,
      max_attempts: parsedBody.data.max_attempts ?? 5,
      updated_at: nowIso,
    };

    const { data, error } = await supabase
      .from("bg_jobs")
      .insert(insertPayload)
      .select("id, type, company_id, payload, status, run_at, attempts, max_attempts, last_error, created_at, updated_at")
      .single();

    if (error || !data) {
      if (error && isMissingBgJobsSchema(error.message || "")) {
        const fallback = enqueueBgJobFallback({
          companyId,
          type: parsedBody.data.type,
          payload: parsedBody.data.payload,
          runAt: parsedBody.data.run_at ?? nowIso,
          maxAttempts: parsedBody.data.max_attempts ?? 5,
        });
        return okItem(fallback, 201);
      }
      return serverError();
    }

    return okItem(data, 201);
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return toTenantErrorResponse(error);
    }
    return serverError();
  }
}
