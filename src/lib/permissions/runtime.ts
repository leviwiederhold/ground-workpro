import { getCompanyId } from "@/lib/tenant/getCompanyId";
import type { AppRole } from "@/lib/nav/config";
import {
  checkModuleAccessLevel,
  getDefaultPermissionsByRole,
} from "@/lib/permissions/access";
import type {
  ModuleAccessLevel,
  ModulePermissionKey,
  ModulePermissionMap,
} from "@/lib/permissions/types";

export const TEST_MODULE_ACCESS_COOKIE = "gw_test_module_access";

export function isRoleFullAccess(role: AppRole): boolean {
  return role === "admin";
}

export function getDefaultPermissionMapForAppRole(role: AppRole): ModulePermissionMap {
  return getDefaultPermissionsByRole(role);
}

export async function resolveUserModulePermissions(params: {
  supabase: Awaited<ReturnType<typeof getCompanyId>>["supabase"];
  companyId: string;
  userId: string;
  role: AppRole;
}): Promise<ModulePermissionMap> {
  if (isRoleFullAccess(params.role)) {
    return getDefaultPermissionsByRole("owner");
  }

  const base = getDefaultPermissionMapForAppRole(params.role);
  const { data, error } = await params.supabase
    .from("module_permissions")
    .select("module_key, access_level")
    .eq("company_id", params.companyId)
    .eq("user_id", params.userId);

  if (error || !data) return base;

  for (const row of data) {
    const key = row.module_key as ModulePermissionKey | null;
    const access = row.access_level as ModuleAccessLevel | null;
    if (!key || !access) continue;
    base[key] = access;
  }
  return base;
}

export function hasModuleAccess(
  permissions: ModulePermissionMap,
  moduleKey: ModulePermissionKey,
  required: ModuleAccessLevel
): boolean {
  return checkModuleAccessLevel(permissions, moduleKey, required);
}

export function applyPermissionOverrideFromCookie(
  base: ModulePermissionMap,
  rawCookie: string | undefined
): ModulePermissionMap {
  if (!rawCookie) return base;
  try {
    const parsed = JSON.parse(rawCookie) as Partial<Record<ModulePermissionKey, ModuleAccessLevel>>;
    const next = { ...base };
    for (const [key, value] of Object.entries(parsed)) {
      if (!(key in next)) continue;
      if (value !== "none" && value !== "view" && value !== "edit") continue;
      next[key as ModulePermissionKey] = value;
    }
    return next;
  } catch {
    return base;
  }
}
