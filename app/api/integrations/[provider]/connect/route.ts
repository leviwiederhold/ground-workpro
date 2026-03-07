import { z } from "zod";
import { requireRole } from "@/lib/auth/requireRole";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { okItem } from "@/lib/http/json";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { parseProviderKey } from "@/lib/integrations/providerAdapters";
import { logAuditEvent } from "@/lib/audit/logAuditEvent";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  provider: z.string().trim().min(1).max(64).regex(/^[a-z0-9-]+$/),
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

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  try {
    const rawParams = await params;
    const parsedParams = paramsSchema.safeParse(rawParams);
    if (!parsedParams.success) {
      return validationError(toValidationDetails(parsedParams.error));
    }

    try {
      await requireRole(["admin", "pm"]);
    } catch {
      return forbidden();
    }

    const { supabase, companyId, userId } = await getCompanyId();
    const nowIso = new Date().toISOString();
    const provider = parsedParams.data.provider;
    const providerKey = parseProviderKey(provider);
    if (!providerKey) {
      return validationError([{ path: "provider", message: "Unsupported provider" }]);
    }

    const { data: beforeRow } = await supabase
      .from("integration_connections")
      .select("id, provider, connected, connected_at, disconnected_at, created_at, updated_at")
      .eq("company_id", companyId)
      .eq("provider", providerKey)
      .maybeSingle();

    const payload = {
      company_id: companyId,
      provider: providerKey,
      connected: true,
      connected_at: nowIso,
      disconnected_at: null,
      updated_at: nowIso,
    };

    const { data, error } = await supabase
      .from("integration_connections")
      .upsert(payload, { onConflict: "company_id,provider" })
      .select("id, provider, connected, connected_at, disconnected_at, created_at, updated_at")
      .single();

    if (error || !data) {
      return serverError();
    }

    await logAuditEvent({
      supabase,
      companyId,
      actorUserId: userId,
      eventType: "integration.connected",
      entityType: "integration_connection",
      entityId: data.id,
      before: (beforeRow ?? null) as Record<string, unknown> | null,
      after: data as unknown as Record<string, unknown>,
      metadata: { provider: providerKey },
    });

    return okItem(data);
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return toTenantErrorResponse(error);
    }
    return serverError();
  }
}
