import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { okItems } from "@/lib/http/json";
import { forbidden, notFound, serverError } from "@/lib/http/errors";
import { parseProviderKey } from "@/lib/integrations/providerAdapters";

export const dynamic = "force-dynamic";

function toTenantErrorResponse(error: TenantResolverError) {
  if (error.status === 404) return notFound(error.message);
  if (error.status === 403) return forbidden(error.message);
  return serverError(error.message);
}

const integrationConnectionSchema = z.object({
  id: z.string().uuid(),
  provider: z.string(),
  connected: z.boolean(),
  connected_at: z.string().nullable().optional(),
  disconnected_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

export async function GET() {
  try {
    const { supabase, companyId } = await getCompanyId();

    const { data, error } = await supabase
      .from("integration_connections")
      .select("id, provider, connected, connected_at, disconnected_at, created_at, updated_at")
      .eq("company_id", companyId)
      .order("provider", { ascending: true });

    if (error) {
      return serverError();
    }

    const parsed = z
      .array(integrationConnectionSchema)
      .safeParse((data ?? []).filter((item) => parseProviderKey(item.provider) !== null));
    if (!parsed.success) {
      return okItems([]);
    }

    return okItems(parsed.data);
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return toTenantErrorResponse(error);
    }
    return serverError();
  }
}
