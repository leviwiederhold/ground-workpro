import { z } from "next/dist/compiled/zod";
import { requireRole } from "@/lib/auth/requireRole";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { okItem, okSuccess } from "@/lib/http/json";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { parseProviderKey } from "@/lib/integrations/providerAdapters";
import { encryptCredential } from "@/lib/integrations/providerCredentialsCrypto";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  provider: z.string().trim().min(1).max(64).regex(/^[a-z0-9-]+$/),
});

const bodySchema = z
  .object({
    status: z.string().trim().min(1).max(64).optional(),
    scopes: z.array(z.string().trim().min(1)).optional(),
    access_token: z.string().trim().min(1).nullable().optional(),
    refresh_token: z.string().trim().min(1).nullable().optional(),
    expires_at: z.string().datetime().nullable().optional(),
    metadata_json: z.record(z.any()).optional(),
  })
  .refine((value: Record<string, unknown>) => Object.keys(value).length > 0, {
    message: "At least one field is required",
    path: [],
  });

const responseSchema = z.object({
  id: z.string().uuid(),
  provider: z.string(),
  status: z.string(),
  scopes: z.array(z.string()).optional().default([]),
  expires_at: z.string().nullable().optional(),
  metadata_json: z.record(z.any()).nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  access_token_enc: z.string().nullable().optional(),
  refresh_token_enc: z.string().nullable().optional(),
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

type CredentialRow = {
  id: string;
  provider: string;
  status: string;
  scopes?: string[];
  expires_at?: string | null;
  metadata_json?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
  access_token_enc?: string | null;
  refresh_token_enc?: string | null;
};

function redactRow(row: CredentialRow) {
  return {
    id: row.id,
    provider: row.provider,
    status: row.status,
    scopes: row.scopes ?? [],
    expires_at: row.expires_at ?? null,
    metadata_json: row.metadata_json ?? {},
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    has_access_token: !!row.access_token_enc,
    has_refresh_token: !!row.refresh_token_enc,
  };
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  try {
    const rawParams = await params;
    const parsedParams = paramsSchema.safeParse(rawParams);
    if (!parsedParams.success) {
      return validationError(toValidationDetails(parsedParams.error));
    }

    const providerKey = parseProviderKey(parsedParams.data.provider);
    if (!providerKey) {
      return validationError([{ path: "provider", message: "Unsupported provider" }]);
    }

    const payload = await request.json().catch(() => null);
    const parsedBody = bodySchema.safeParse(payload);
    if (!parsedBody.success) {
      return validationError(toValidationDetails(parsedBody.error));
    }

    try {
      await requireRole(["admin", "pm"]);
    } catch {
      return forbidden();
    }

    const { supabase, companyId } = await getCompanyId();
    const nowIso = new Date().toISOString();

    const updatePayload: Record<string, unknown> = {
      company_id: companyId,
      provider: providerKey,
      updated_at: nowIso,
    };

    if (parsedBody.data.status !== undefined) updatePayload.status = parsedBody.data.status;
    if (parsedBody.data.scopes !== undefined) updatePayload.scopes = parsedBody.data.scopes;
    if (parsedBody.data.expires_at !== undefined) updatePayload.expires_at = parsedBody.data.expires_at;
    if (parsedBody.data.metadata_json !== undefined) updatePayload.metadata_json = parsedBody.data.metadata_json;
    if (parsedBody.data.access_token !== undefined) {
      updatePayload.access_token_enc =
        parsedBody.data.access_token === null ? null : encryptCredential(parsedBody.data.access_token);
    }
    if (parsedBody.data.refresh_token !== undefined) {
      updatePayload.refresh_token_enc =
        parsedBody.data.refresh_token === null ? null : encryptCredential(parsedBody.data.refresh_token);
    }

    const { data, error } = await supabase
      .from("provider_credentials")
      .upsert(updatePayload, { onConflict: "company_id,provider" })
      .select(
        "id, provider, status, scopes, expires_at, metadata_json, created_at, updated_at, access_token_enc, refresh_token_enc"
      )
      .single();

    if (error || !data) {
      return serverError();
    }

    const parsed = responseSchema.safeParse(data);
    if (!parsed.success) {
      return serverError();
    }

    return okItem(redactRow(parsed.data));
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return toTenantErrorResponse(error);
    }
    return serverError();
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  try {
    const rawParams = await params;
    const parsedParams = paramsSchema.safeParse(rawParams);
    if (!parsedParams.success) {
      return validationError(toValidationDetails(parsedParams.error));
    }

    const providerKey = parseProviderKey(parsedParams.data.provider);
    if (!providerKey) {
      return validationError([{ path: "provider", message: "Unsupported provider" }]);
    }

    try {
      await requireRole(["admin", "pm"]);
    } catch {
      return forbidden();
    }

    const { supabase, companyId } = await getCompanyId();
    const { error, count } = await supabase
      .from("provider_credentials")
      .delete({ count: "exact" })
      .eq("company_id", companyId)
      .eq("provider", providerKey);

    if (error) {
      return serverError();
    }

    if (!count) {
      return notFound("Credential not found");
    }

    return okSuccess();
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return toTenantErrorResponse(error);
    }
    return serverError();
  }
}
