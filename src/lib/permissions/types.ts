import { z } from "zod";
import {
  canonicalTeamRoles,
  canonicalTeamRoleSchema,
  type CanonicalTeamRole,
} from "../auth/teamRoles.ts";

export const modulePermissionKeys = [
  "jobs",
  "fleet",
  "maintenance",
  "daily_reports",
  "safety",
  "messages",
  "inventory",
  "reports",
  "vendors",
  "documents",
  "training",
  "finance",
  "integrations",
  "team_management",
] as const;

export const moduleAccessLevels = ["none", "view", "edit"] as const;

export const legacyInvitationRoles = [
  "ceo",
  "manager",
  "foreman",
  "mechanic",
  "operator",
  "fieldstaff",
] as const;

export const invitationRoles = canonicalTeamRoles;
export const compatibleInvitationRoles = [
  "owner",
  "co_owner",
  "administrator",
  "manager",
  "crew_lead",
  "team_member",
  "ceo",
  "foreman",
  "mechanic",
  "operator",
  "fieldstaff",
  "admin",
  "pm",
] as const;

export type ModulePermissionKey = (typeof modulePermissionKeys)[number];
export type ModuleAccessLevel = (typeof moduleAccessLevels)[number];
export type InvitationRole = (typeof invitationRoles)[number];
export type CompatibleInvitationRole = (typeof compatibleInvitationRoles)[number];
export type { CanonicalTeamRole };

export const modulePermissionKeySchema = z.enum(modulePermissionKeys);
export const moduleAccessLevelSchema = z.enum(moduleAccessLevels);
export const invitationRoleSchema = canonicalTeamRoleSchema;
export const compatibleInvitationRoleSchema = z.enum(compatibleInvitationRoles);

export const modulePermissionMapSchema = z.record(
  modulePermissionKeySchema,
  moduleAccessLevelSchema
);

export type ModulePermissionMap = Record<ModulePermissionKey, ModuleAccessLevel>;

export type ModulePermissionRow = {
  module_key: ModulePermissionKey;
  access_level: ModuleAccessLevel;
};
