import { z } from "zod";
import { requireModuleAccess } from "@/lib/auth/requireRole";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { okSuccess } from "@/lib/http/json";
import { deleteFallbackSafetyLog } from "@/lib/safety/fallbackStore";
import { logAuditEvent } from "@/lib/audit/logAuditEvent";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  id: z.string().uuid(),
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

function isMissingSafetyLogsTable(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("safety_logs") && (normalized.includes("does not exist") || normalized.includes("not find"));
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const parsedParams = paramsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return validationError(toValidationDetails(parsedParams.error));
    }

    try {
      await requireModuleAccess("safety", "edit");
    } catch {
      return forbidden();
    }

    const { supabase, companyId, userId } = await getCompanyId();

    const { data: beforeRow } = await supabase
      .from("safety_logs")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", parsedParams.data.id)
      .maybeSingle();

    const { data, error } = await supabase
      .from("safety_logs")
      .delete()
      .eq("company_id", companyId)
      .eq("id", parsedParams.data.id)
      .select("id")
      .maybeSingle();

    if (error) {
      if (isMissingSafetyLogsTable(error.message)) {
        const removed = deleteFallbackSafetyLog(companyId, parsedParams.data.id);
        if (!removed) return notFound("Not found");
        return okSuccess();
      }
      const removed = deleteFallbackSafetyLog(companyId, parsedParams.data.id);
      if (!removed) return notFound("Not found");
      return okSuccess();
    }
    if (!data) {
      const removedFallback = deleteFallbackSafetyLog(companyId, parsedParams.data.id);
      if (!removedFallback) return notFound("Not found");
      return okSuccess();
    }

    await logAuditEvent({
      supabase,
      companyId,
      actorUserId: userId,
      eventType: "safety_log.deleted",
      entityType: "safety_log",
      entityId: parsedParams.data.id,
      before: (data ?? beforeRow ?? null) as Record<string, unknown> | null,
    });

    return okSuccess();
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return toTenantErrorResponse(error);
    }
    return serverError();
  }
}
