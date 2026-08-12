import { z } from "zod";

/**
 * Application-facing access roles. These values are deliberately independent
 * from an employee's free-form job_title.
 */
export const canonicalTeamRoles = [
  "owner",
  "administrator",
  "manager",
  "crew_lead",
  "team_member",
] as const;

export type CanonicalTeamRole = (typeof canonicalTeamRoles)[number];

/**
 * Internal compatibility profiles preserve the authorization behavior shipped
 * by older Groundwork Pro clients. In particular, mechanic and fieldstaff were
 * specialized permission profiles rather than job titles in the legacy model.
 */
export const legacyPermissionProfiles = [
  "admin",
  "pm",
  "foreman",
  "mechanic",
  "operator",
  "fieldstaff",
] as const;

export type LegacyPermissionProfile = (typeof legacyPermissionProfiles)[number];

export const canonicalTeamRoleSchema = z.enum(canonicalTeamRoles);
export const legacyPermissionProfileSchema = z.enum(legacyPermissionProfiles);

/**
 * During a rolling deploy, application servers may start before the database
 * migration adds the compatibility profile column. Reads can safely retry the
 * legacy role-only contract. Write paths may retry with the role's legacy
 * storage value: the legacy value itself carries the permission profile, so no
 * authorization information is lost during the deploy-before-migration window.
 */
export function isMissingLegacyPermissionProfileColumn(error: unknown): boolean {
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "");
  return /legacy_permission_profile/i.test(message) &&
    /(does not exist|could not find|schema cache|column)/i.test(message);
}

const compactRole = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const ownerAliases = new Set(["owner", "admin", "executive", "ceo", "coceo"]);
const administratorAliases = new Set(["administrator"]);
const managerAliases = new Set([
  "manager",
  "pm",
  "operations",
  "operationsmanager",
  "projectmanager",
]);
const crewLeadAliases = new Set(["crewlead", "foreman"]);
const teamMemberAliases = new Set([
  "teammember",
  "employee",
  "mechanic",
  "operator",
  "field",
  "fieldstaff",
  "laborer",
  "labourer",
  "technician",
]);

export function normalizeCanonicalTeamRole(value: unknown): CanonicalTeamRole | null {
  const normalized = compactRole(value);
  if (!normalized) return null;
  if (ownerAliases.has(normalized)) return "owner";
  if (administratorAliases.has(normalized)) return "administrator";
  if (managerAliases.has(normalized)) return "manager";
  if (crewLeadAliases.has(normalized)) return "crew_lead";
  if (teamMemberAliases.has(normalized)) return "team_member";
  return null;
}

export function isOwnerTeamRole(value: unknown): boolean {
  return normalizeCanonicalTeamRole(value) === "owner";
}

/**
 * Assigning the Owner access role is the only role transition that requires a
 * top-level actor. Non-Owner roles keep the existing module-permission guard.
 */
export function canAssignTeamRole(actorRole: unknown, requestedRole: unknown): boolean {
  if (!isOwnerTeamRole(requestedRole)) return true;
  return normalizeLegacyPermissionProfile(actorRole) === "admin";
}

export function defaultPermissionProfileForRole(
  value: unknown
): LegacyPermissionProfile | null {
  const canonical = normalizeCanonicalTeamRole(value);
  if (!canonical) return null;
  if (canonical === "owner") return "admin";
  if (canonical === "administrator" || canonical === "manager") return "pm";
  if (canonical === "crew_lead") return "foreman";
  return "operator";
}

export function normalizeLegacyPermissionProfile(
  role: unknown,
  explicitProfile?: unknown
): LegacyPermissionProfile | null {
  const profile = compactRole(explicitProfile);
  if (legacyPermissionProfiles.includes(profile as LegacyPermissionProfile)) {
    return profile as LegacyPermissionProfile;
  }

  // Preserve the exact legacy behavior when the role itself is from an older
  // row/session/client. New canonical roles use their deliberately conservative
  // defaults (Administrator and Manager both use the former PM profile).
  const raw = compactRole(role);
  if (raw === "mechanic") return "mechanic";
  if (raw === "fieldstaff" || raw === "field") return "fieldstaff";
  if (raw === "operator" || raw === "laborer" || raw === "labourer") return "operator";
  if (raw === "foreman") return "foreman";
  if (raw === "pm" || raw === "operations" || raw === "operationsmanager" || raw === "projectmanager") {
    return "pm";
  }
  if (raw === "admin" || raw === "executive" || raw === "ceo" || raw === "coceo") {
    return "admin";
  }
  return defaultPermissionProfileForRole(role);
}

export function canonicalizeRoleWrite(value: unknown): {
  role: CanonicalTeamRole;
  legacy_permission_profile: LegacyPermissionProfile;
} {
  const role = normalizeCanonicalTeamRole(value) ?? "team_member";
  const legacy_permission_profile =
    normalizeLegacyPermissionProfile(value) ?? defaultPermissionProfileForRole(role) ?? "operator";
  return { role, legacy_permission_profile };
}

export type LegacyRoleStorageTarget =
  | "memberships"
  | "employees"
  | "pending_invitations"
  | "invite_tokens";

/**
 * Values understood by the pre-migration schema and released native clients.
 * Pending invitations historically used CEO/manager terminology, while the
 * membership/employee/token tables used the internal permission profile names.
 */
export function legacyCompatibleRoleValue(
  value: unknown,
  target: LegacyRoleStorageTarget
): LegacyPermissionProfile | "ceo" | "manager" {
  const profile = normalizeLegacyPermissionProfile(value) ?? "operator";
  if (target !== "pending_invitations") {
    // The legacy membership/employee checks did not admit fieldstaff. Its
    // effective shell role was operator; invitation-level explicit permission
    // rows preserve the narrower fieldstaff bundle during this brief window.
    return profile === "fieldstaff" ? "operator" : profile;
  }
  if (profile === "admin") return "ceo";
  if (profile === "pm") return "manager";
  return profile;
}

export function legacyCompatibleRoleWrite(
  value: unknown,
  target: LegacyRoleStorageTarget
): { role: string } {
  return { role: legacyCompatibleRoleValue(value, target) };
}

export const canonicalTeamRoleLabels: Record<CanonicalTeamRole, string> = {
  owner: "Owner",
  administrator: "Administrator",
  manager: "Manager",
  crew_lead: "Crew Lead",
  team_member: "Team Member",
};

export function canonicalTeamRoleLabel(value: unknown): string {
  const role = normalizeCanonicalTeamRole(value) ?? "team_member";
  return canonicalTeamRoleLabels[role];
}
