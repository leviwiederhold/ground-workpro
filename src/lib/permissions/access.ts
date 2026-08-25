import { z } from "zod";
import type { AppRole } from "../nav/config.ts";
import {
  canonicalizeRoleWrite,
  isOwnerLevelTeamRole,
  isOwnerTeamRole,
  normalizeCanonicalTeamRole,
  normalizeLegacyPermissionProfile,
  type LegacyPermissionProfile,
} from "../auth/teamRoles.ts";
import {
  compatibleInvitationRoleSchema,
  moduleAccessLevelSchema,
  modulePermissionKeySchema,
  modulePermissionKeys,
  type InvitationRole,
  type CompatibleInvitationRole,
  type ModuleAccessLevel,
  type ModulePermissionKey,
  type ModulePermissionMap,
  type ModulePermissionRow,
} from "./types.ts";

const accessRank: Record<ModuleAccessLevel, number> = {
  none: 0,
  view: 1,
  edit: 2,
};

// Finance and Reports are sensitive (financials) and restricted to Manager-level
// and above (manager + owner/admin "ceo"). Any role below Manager must never be
// granted Finance/Reports, even if a request includes them — they are stripped
// server-side here.
const MANAGER_LEVEL_TEMPLATE_ROLES = new Set(["admin", "pm"]);
const SENSITIVE_MANAGER_ONLY_MODULES: ModulePermissionKey[] = ["finance", "reports"];

export function isManagerLevelInvitationRole(role: CompatibleInvitationRole | AppRole): boolean {
  const profile = normalizeLegacyPermissionProfile(role);
  return profile ? MANAGER_LEVEL_TEMPLATE_ROLES.has(profile) : false;
}

const templateDefaults: Record<LegacyPermissionProfile, ModulePermissionMap> = {
  admin: {
    jobs: "edit",
    fleet: "edit",
    maintenance: "edit",
    daily_reports: "edit",
    safety: "edit",
    messages: "edit",
    inventory: "edit",
    reports: "edit",
    vendors: "edit",
    documents: "edit",
    training: "edit",
    finance: "edit",
    integrations: "edit",
    team_management: "edit",
  },
  pm: {
    jobs: "edit",
    fleet: "view",
    maintenance: "edit",
    daily_reports: "edit",
    safety: "edit",
    messages: "edit",
    inventory: "edit",
    // Finance and Reports are enabled by default for Manager-level and above,
    // but VIEW-only — full edit of sensitive financial data stays with
    // owner/admin (ceo) by default. Admins can still grant edit per-user.
    reports: "view",
    vendors: "edit",
    documents: "edit",
    training: "edit",
    finance: "view",
    integrations: "none",
    team_management: "view",
  },
  foreman: {
    jobs: "view",
    fleet: "view",
    maintenance: "view",
    daily_reports: "edit",
    safety: "edit",
    messages: "edit",
    inventory: "none",
    reports: "none",
    vendors: "none",
    documents: "view",
    training: "view",
    finance: "none",
    integrations: "none",
    team_management: "none",
  },
  mechanic: {
    jobs: "none",
    fleet: "edit",
    maintenance: "edit",
    daily_reports: "none",
    safety: "view",
    messages: "edit",
    inventory: "edit",
    reports: "none",
    vendors: "none",
    documents: "none",
    training: "view",
    finance: "none",
    integrations: "none",
    team_management: "none",
  },
  operator: {
    jobs: "none",
    fleet: "view",
    maintenance: "none",
    daily_reports: "edit",
    safety: "edit",
    messages: "edit",
    inventory: "none",
    reports: "none",
    vendors: "none",
    documents: "view",
    training: "none",
    finance: "none",
    integrations: "none",
    team_management: "none",
  },
  fieldstaff: {
    jobs: "none",
    fleet: "none",
    maintenance: "none",
    daily_reports: "edit",
    safety: "edit",
    messages: "view",
    inventory: "none",
    reports: "none",
    vendors: "none",
    documents: "view",
    training: "none",
    finance: "none",
    integrations: "none",
    team_management: "none",
  },
};

const normalizedPayloadSchema = z.object({
  role: compatibleInvitationRoleSchema,
  permissions: z
    .array(
      z.object({
        module_key: modulePermissionKeySchema,
        access_level: moduleAccessLevelSchema,
      })
    )
    .default([]),
});

export function getDefaultPermissionsByRole(
  role: unknown,
  explicitProfile?: unknown
): ModulePermissionMap {
  const templateRole = normalizeLegacyPermissionProfile(role, explicitProfile) ?? "fieldstaff";
  return { ...templateDefaults[templateRole] };
}

type StoredPermissionInput = Partial<ModulePermissionMap> | ModulePermissionRow[];

function toStoredPermissionMap(input: StoredPermissionInput | undefined): Partial<ModulePermissionMap> {
  if (!input) return {};
  if (!Array.isArray(input)) return input;
  return Object.fromEntries(
    input.map((row) => [row.module_key, row.access_level])
  ) as Partial<ModulePermissionMap>;
}

/**
 * The live database canonicalizes both Operator and Field Staff to
 * `team_member`. Preserve the existing UI role distinction by comparing the
 * already-persisted permission profile; memberships remain on the canonical
 * role model and no parallel authorization role is introduced.
 */
export function resolveStoredInvitationRole(
  rawRole: unknown,
  permissions?: StoredPermissionInput
): CompatibleInvitationRole {
  const normalized = String(rawRole ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");

  if (normalized.includes("owner") || normalized.includes("admin") || normalized.includes("executive") || normalized.includes("ceo")) {
    return "ceo";
  }
  if (normalized === "pm" || normalized === "manager" || normalized.includes("operations") || normalized.includes("projectmanager")) {
    return "manager";
  }
  if (normalized.includes("foreman") || normalized.includes("crewlead")) return "foreman";
  if (normalized.includes("mechanic")) return "mechanic";
  if (normalized.includes("fieldstaff")) return "fieldstaff";

  const permissionMap = toStoredPermissionMap(permissions);
  const operatorDefaults = getDefaultPermissionsByRole("operator");
  const fieldStaffDefaults = getDefaultPermissionsByRole("fieldstaff");
  let operatorDistance = 0;
  let fieldStaffDistance = 0;
  let compared = 0;
  for (const key of modulePermissionKeys) {
    const value = permissionMap[key];
    if (!value) continue;
    compared += 1;
    if (value !== operatorDefaults[key]) operatorDistance += 1;
    if (value !== fieldStaffDefaults[key]) fieldStaffDistance += 1;
  }

  return compared > 0 && fieldStaffDistance < operatorDistance ? "fieldstaff" : "operator";
}

export function normalizePermissionPayload(input: unknown): {
  role: InvitationRole;
  permissions: ModulePermissionMap;
} {
  const parsed = normalizedPayloadSchema.parse(input);
  const base = getDefaultPermissionsByRole(parsed.role);
  const merged: ModulePermissionMap = { ...base };

  for (const row of parsed.permissions) {
    merged[row.module_key] = row.access_level;
  }

  for (const key of modulePermissionKeys) {
    if (!merged[key]) merged[key] = "none";
  }

  // Strip Finance/Reports for any role below Manager — sensitive financials stay
  // Manager+ only, regardless of what the client submitted. (CEO is overridden to
  // full access below.)
  if (!isManagerLevelInvitationRole(parsed.role)) {
    for (const key of SENSITIVE_MANAGER_ONLY_MODULES) merged[key] = "none";
  }

  if (isOwnerLevelTeamRole(parsed.role)) {
    for (const key of modulePermissionKeys) merged[key] = "edit";
  }

  return {
    role: canonicalizeRoleWrite(parsed.role).role,
    permissions: merged,
  };
}

export function checkModuleAccessLevel(
  permissions: ModulePermissionMap | ModulePermissionRow[],
  moduleKey: ModulePermissionKey,
  required: ModuleAccessLevel = "view"
): boolean {
  const resolved = Array.isArray(permissions)
    ? permissions.find((entry) => entry.module_key === moduleKey)?.access_level ?? "none"
    : permissions[moduleKey] ?? "none";

  return accessRank[resolved] >= accessRank[required];
}

export function assertCeoSelfAccessNotReduced(params: {
  actorUserId: string;
  targetUserId: string;
  targetRole: InvitationRole | AppRole;
  nextPermissions: ModulePermissionMap;
}) {
  if (params.actorUserId !== params.targetUserId) return;
  if (!isOwnerTeamRole(params.targetRole)) return;

  const lowered = modulePermissionKeys.find(
    (key) => params.nextPermissions[key] !== "edit"
  );
  if (lowered) {
    throw new Error("Owner must retain edit access for all modules");
  }
}

export function assertCeoAccessLocked(params: {
  isTargetCeo: boolean;
  requestedRole: InvitationRole | AppRole;
  nextPermissions: ModulePermissionMap;
}) {
  if (!params.isTargetCeo) return;

  if (normalizeCanonicalTeamRole(params.requestedRole) !== "owner") {
    throw new Error("Owner role is locked and cannot be changed");
  }

  const lowered = modulePermissionKeys.find(
    (key) => params.nextPermissions[key] !== "edit"
  );
  if (lowered) {
    throw new Error("Owner must retain edit access for all modules");
  }
}
