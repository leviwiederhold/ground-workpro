import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireModuleAccess } from "@/lib/auth/requireRole";
import { forbidden, serverError, validationError } from "@/lib/http/errors";
import { okItem } from "@/lib/http/json";
import {
  pushDeviceRegistrationSchema,
  pushDeviceRevocationSchema,
} from "@/lib/push/registration";

export const dynamic = "force-dynamic";

function validationDetails(error: { issues: Array<{ path: Array<string | number>; message: string }> }) {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

function tenantError(error: TenantResolverError) {
  return error.status === 403 ? forbidden(error.message) : serverError(error.message);
}

export async function POST(request: Request) {
  try {
    try {
      await requireModuleAccess("messages", "view");
    } catch {
      return forbidden();
    }

    const parsed = pushDeviceRegistrationSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return validationError(validationDetails(parsed.error));

    const { supabase, companyId } = await getCompanyId();
    const { data, error } = await supabase.rpc("register_push_device", {
      p_company_id: companyId,
      p_platform: parsed.data.platform,
      p_device_id: parsed.data.deviceId,
      p_push_token: parsed.data.token,
      p_environment: parsed.data.environment,
    });
    if (error) return serverError(error.message);

    const row = Array.isArray(data) ? data[0] : data;
    return okItem({
      id: row?.device_row_id ?? null,
      platform: row?.registered_platform ?? parsed.data.platform,
      deviceId: row?.registered_device_id ?? parsed.data.deviceId,
      enabled: row?.registered_enabled ?? true,
      registeredAt: row?.registered_at ?? new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof TenantResolverError) return tenantError(error);
    return serverError(error instanceof Error ? error.message : "Failed to register push device");
  }
}

export async function DELETE(request: Request) {
  try {
    const parsed = pushDeviceRevocationSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return validationError(validationDetails(parsed.error));

    const { supabase } = await getCompanyId();
    const { data, error } = await supabase.rpc("revoke_push_device", {
      p_platform: parsed.data.platform,
      p_device_id: parsed.data.deviceId,
    });
    if (error) return serverError(error.message);
    return okItem({ revoked: Boolean(data) });
  } catch (error) {
    if (error instanceof TenantResolverError) return tenantError(error);
    return serverError(error instanceof Error ? error.message : "Failed to revoke push device");
  }
}
