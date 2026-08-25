import type { ModuleAccessLevel, ModulePermissionMap } from "@/lib/permissions/types";
import { isOwnerLevelTeamRole } from "@/lib/auth/teamRoles";

export const SENSITIVE_PERMISSION_WARNING_COPY =
  "Warning: This page may contain sensitive financial or compensation-related information, including revenue, costs, profitability, billing, or employee pay-related details. Be sure this employee should have access before continuing.";

export const SENSITIVE_PERMISSION_MODULES = {
  finance: "Finance",
  reports: "Reports",
  billing: "Billing",
} as const;

export type SensitivePermissionGrant = {
  key: keyof typeof SENSITIVE_PERMISSION_MODULES;
  label: (typeof SENSITIVE_PERMISSION_MODULES)[keyof typeof SENSITIVE_PERMISSION_MODULES];
  accessLevel: ModuleAccessLevel;
};

const isGranted = (value: unknown): value is ModuleAccessLevel =>
  value === "view" || value === "edit";

export function isSensitivePermissionModule(moduleKey: string): boolean {
  return moduleKey === "finance" || moduleKey === "reports" || moduleKey === "billing";
}

export function getSensitiveInvitePermissionGrants(params: {
  role: string;
  permissions: Partial<ModulePermissionMap> & Record<string, unknown>;
}): SensitivePermissionGrant[] {
  const grants: SensitivePermissionGrant[] = [];
  const financeLevel = params.permissions.finance;
  const reportsLevel = params.permissions.reports;
  const billingLevel = params.permissions.billing;

  if (isGranted(financeLevel)) {
    grants.push({
      key: "finance",
      label: SENSITIVE_PERMISSION_MODULES.finance,
      accessLevel: financeLevel,
    });
  }

  if (isGranted(reportsLevel)) {
    grants.push({
      key: "reports",
      label: SENSITIVE_PERMISSION_MODULES.reports,
      accessLevel: reportsLevel,
    });
  }

  if (isGranted(billingLevel)) {
    grants.push({
      key: "billing",
      label: SENSITIVE_PERMISSION_MODULES.billing,
      accessLevel: billingLevel,
    });
  } else if (isOwnerLevelTeamRole(params.role)) {
    grants.push({
      key: "billing",
      label: SENSITIVE_PERMISSION_MODULES.billing,
      accessLevel: "edit",
    });
  }

  return grants;
}
