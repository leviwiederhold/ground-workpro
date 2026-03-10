import { getCompanyId } from "@/lib/tenant/getCompanyId";
import { getEffectiveRole } from "@/lib/auth/effectiveRole";
import * as Sentry from "@sentry/nextjs";
import {
  applyPermissionOverrideFromCookie,
  hasModuleAccess,
  resolveUserModulePermissions,
  TEST_MODULE_ACCESS_COOKIE,
} from "@/lib/permissions/runtime";
import type { ModuleAccessLevel, ModulePermissionKey } from "@/lib/permissions/types";
import { cookies } from "next/headers";

export type Role = "admin" | "pm" | "foreman" | "mechanic" | "operator";

export class ForbiddenError extends Error {
  status: number;

  constructor(message = "Forbidden") {
    super(message);
    this.status = 403;
  }
}

export function hasRole(role: Role, allowed: Role[]): boolean {
  return allowed.includes(role);
}

export async function requireRole(allowed: Role[]): Promise<{
  userId: string;
  companyId: string;
  role: Role;
}> {
  const { companyId, userId } = await getCompanyId();
  const role = (await getEffectiveRole()) as Role | null;
  if (!role || !hasRole(role, allowed)) {
    throw new ForbiddenError();
  }

  Sentry.setTag("role", role);

  return { userId, companyId, role };
}

export async function requireModuleAccess(
  moduleKey: ModulePermissionKey,
  required: ModuleAccessLevel = "view"
): Promise<{
  userId: string;
  companyId: string;
  role: Role;
}> {
  const { supabase, companyId, userId } = await getCompanyId();
  const role = (await getEffectiveRole()) as Role | null;
  if (!role) {
    throw new ForbiddenError();
  }

  const permissions = await resolveUserModulePermissions({
    supabase,
    companyId,
    userId,
    role,
  });
  const cookieStore = await cookies();
  const effectivePermissions =
    process.env.NODE_ENV !== "production"
      ? applyPermissionOverrideFromCookie(
          permissions,
          cookieStore.get(TEST_MODULE_ACCESS_COOKIE)?.value
        )
      : permissions;

  if (!hasModuleAccess(effectivePermissions, moduleKey, required)) {
    throw new ForbiddenError();
  }

  Sentry.setTag("role", role);
  Sentry.setTag("module", moduleKey);
  return { userId, companyId, role };
}
