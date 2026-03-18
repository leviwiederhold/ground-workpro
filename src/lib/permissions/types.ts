import { z } from "zod";

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

export const invitationRoles = [
  "ceo",
  "manager",
  "foreman",
  "mechanic",
  "operator",
  "fieldstaff",
] as const;

export type ModulePermissionKey = (typeof modulePermissionKeys)[number];
export type ModuleAccessLevel = (typeof moduleAccessLevels)[number];
export type InvitationRole = (typeof invitationRoles)[number];

export const modulePermissionKeySchema = z.enum(modulePermissionKeys);
export const moduleAccessLevelSchema = z.enum(moduleAccessLevels);
export const invitationRoleSchema = z.enum(invitationRoles);

export const modulePermissionMapSchema = z.record(
  modulePermissionKeySchema,
  moduleAccessLevelSchema
);

export type ModulePermissionMap = Record<ModulePermissionKey, ModuleAccessLevel>;

export type ModulePermissionRow = {
  module_key: ModulePermissionKey;
  access_level: ModuleAccessLevel;
};
