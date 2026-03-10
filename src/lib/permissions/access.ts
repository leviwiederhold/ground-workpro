import { z } from "zod";
import type { AppRole } from "@/lib/nav/config";
import {
  invitationRoleSchema,
  moduleAccessLevelSchema,
  modulePermissionKeySchema,
  modulePermissionKeys,
  type InvitationRole,
  type ModuleAccessLevel,
  type ModulePermissionKey,
  type ModulePermissionMap,
  type ModulePermissionRow,
} from "./types";

const accessRank: Record<ModuleAccessLevel, number> = {
  none: 0,
  view: 1,
  edit: 2,
};

const roleToTemplateRole: Record<AppRole, InvitationRole> = {
  admin: "ceo",
  pm: "manager",
  foreman: "foreman",
  mechanic: "mechanic",
  operator: "operator",
};

const templateDefaults: Record<InvitationRole, ModulePermissionMap> = {
  ceo: {
    jobs: "edit",
    fleet: "edit",
    maintenance: "edit",
    daily_reports: "edit",
    safety: "edit",
    messages: "edit",
    finance: "edit",
    team_management: "edit",
  },
  manager: {
    jobs: "edit",
    fleet: "view",
    maintenance: "edit",
    daily_reports: "edit",
    safety: "edit",
    messages: "edit",
    finance: "view",
    team_management: "view",
  },
  foreman: {
    jobs: "view",
    fleet: "view",
    maintenance: "view",
    daily_reports: "edit",
    safety: "edit",
    messages: "edit",
    finance: "none",
    team_management: "none",
  },
  mechanic: {
    jobs: "none",
    fleet: "edit",
    maintenance: "edit",
    daily_reports: "none",
    safety: "view",
    messages: "edit",
    finance: "none",
    team_management: "none",
  },
  operator: {
    jobs: "view",
    fleet: "view",
    maintenance: "none",
    daily_reports: "edit",
    safety: "edit",
    messages: "edit",
    finance: "none",
    team_management: "none",
  },
  fieldstaff: {
    jobs: "view",
    fleet: "none",
    maintenance: "none",
    daily_reports: "edit",
    safety: "edit",
    messages: "view",
    finance: "none",
    team_management: "none",
  },
};

const normalizedPayloadSchema = z.object({
  role: invitationRoleSchema,
  permissions: z
    .array(
      z.object({
        module_key: modulePermissionKeySchema,
        access_level: moduleAccessLevelSchema,
      })
    )
    .default([]),
});

export function getDefaultPermissionsByRole(role: InvitationRole | AppRole): ModulePermissionMap {
  const templateRole =
    invitationRoleSchema.safeParse(role).success
      ? (role as InvitationRole)
      : roleToTemplateRole[role as AppRole] ?? "fieldstaff";
  return { ...templateDefaults[templateRole] };
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

  if (parsed.role === "ceo") {
    for (const key of modulePermissionKeys) merged[key] = "edit";
  }

  return {
    role: parsed.role,
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
  const targetTemplateRole =
    invitationRoleSchema.safeParse(params.targetRole).success
      ? (params.targetRole as InvitationRole)
      : roleToTemplateRole[params.targetRole as AppRole] ?? "fieldstaff";

  if (params.actorUserId !== params.targetUserId) return;
  if (targetTemplateRole !== "ceo") return;

  const lowered = modulePermissionKeys.find(
    (key) => params.nextPermissions[key] !== "edit"
  );
  if (lowered) {
    throw new Error("CEO must retain edit access for all modules");
  }
}

export function assertCeoAccessLocked(params: {
  isTargetCeo: boolean;
  requestedRole: InvitationRole | AppRole;
  nextPermissions: ModulePermissionMap;
}) {
  if (!params.isTargetCeo) return;

  const templateRole =
    invitationRoleSchema.safeParse(params.requestedRole).success
      ? (params.requestedRole as InvitationRole)
      : roleToTemplateRole[params.requestedRole as AppRole] ?? "fieldstaff";

  if (templateRole !== "ceo") {
    throw new Error("CEO role is locked and cannot be changed");
  }

  const lowered = modulePermissionKeys.find(
    (key) => params.nextPermissions[key] !== "edit"
  );
  if (lowered) {
    throw new Error("CEO must retain edit access for all modules");
  }
}
