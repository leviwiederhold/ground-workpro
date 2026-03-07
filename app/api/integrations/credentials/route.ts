import { z } from "zod";
import { requireRole } from "@/lib/auth/requireRole";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { okItems } from "@/lib/http/json";
import { forbidden, notFound, serverError } from "@/lib/http/errors";

export const dynamic = "force-dynamic";

const rowSchema = z.object({
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

function toTenantErrorResponse(error: TenantResolverError) {
  if (error.status === 404) return notFound(error.message);
  if (error.status === 403) return forbidden(error.message);
  return serverError(error.message);
}

export async function GET() {
  try {
    try {
      await requireRole(["admin", "pm"]);
    } catch {
      return forbidden();
    }

    const { supabase, companyId } = await getCompanyId();
    const { data, error } = await supabase
      .from("provider_credentials")
      .select(
        "id, provider, status, scopes, expires_at, metadata_json, created_at, updated_at, access_token_enc, refresh_token_enc"
      )
      .eq("company_id", companyId)
      .order("provider", { ascending: true });

    if (error) {
      return serverError();
    }

    const parsed = z.array(rowSchema).safeParse(data ?? []);
    if (!parsed.success) {
      return okItems([]);
    }

    return okItems(
      parsed.data.map((row: CredentialRow) => ({
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
      }))
    );
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return toTenantErrorResponse(error);
    }
    return serverError();
  }
}
