import test from "node:test";
import assert from "node:assert/strict";
import {
  canAssignTeamRole,
  canonicalizeRoleWrite,
  canonicalTeamRoleLabel,
  isOwnerTeamRole,
  legacyCompatibleRoleValue,
  normalizeCanonicalTeamRole,
  normalizeLegacyPermissionProfile,
} from "../../src/lib/auth/teamRoles.ts";
import { normalizeAppRole } from "../../src/lib/nav/config.ts";
import {
  getDefaultPermissionsByRole,
  normalizePermissionPayload,
} from "../../src/lib/permissions/access.ts";
import { isCeoMembershipRole } from "../../src/lib/auth/ceoGuard.ts";

const migrations: Array<[string, string, string]> = [
  ["admin", "owner", "admin"],
  ["ceo", "owner", "admin"],
  ["co_ceo", "owner", "admin"],
  ["executive", "owner", "admin"],
  ["pm", "manager", "pm"],
  ["manager", "manager", "pm"],
  ["foreman", "crew_lead", "foreman"],
  ["mechanic", "team_member", "mechanic"],
  ["operator", "team_member", "operator"],
  ["fieldstaff", "team_member", "fieldstaff"],
];

test("every legacy role maps to a canonical role and preserved permission profile", () => {
  for (const [legacy, canonical, profile] of migrations) {
    assert.deepEqual(canonicalizeRoleWrite(legacy), {
      role: canonical,
      legacy_permission_profile: profile,
    });
  }
});

test("legacy specialized profiles retain their exact permissions", () => {
  const mechanicBefore = getDefaultPermissionsByRole("mechanic");
  const mechanicAfter = getDefaultPermissionsByRole("team_member", "mechanic");
  assert.deepEqual(mechanicAfter, mechanicBefore);
  assert.equal(mechanicAfter.fleet, "edit");
  assert.equal(mechanicAfter.maintenance, "edit");
  assert.equal(mechanicAfter.inventory, "edit");

  const fieldStaffBefore = getDefaultPermissionsByRole("fieldstaff");
  const fieldStaffAfter = getDefaultPermissionsByRole("team_member", "fieldstaff");
  assert.deepEqual(fieldStaffAfter, fieldStaffBefore);
  assert.equal(fieldStaffAfter.messages, "view");
});

test("Administrator is conservative and does not inherit legacy owner access", () => {
  assert.equal(normalizeAppRole("administrator"), "pm");
  assert.equal(normalizeLegacyPermissionProfile("administrator"), "pm");
  assert.deepEqual(
    getDefaultPermissionsByRole("administrator"),
    getDefaultPermissionsByRole("manager")
  );
  assert.equal(getDefaultPermissionsByRole("administrator").integrations, "none");
});

test("Owner aliases retain full access and owner protections", () => {
  for (const role of ["owner", "admin", "ceo", "co-ceo", "co-owner", "executive"]) {
    assert.equal(isOwnerTeamRole(role), true);
    assert.equal(isCeoMembershipRole(role), true);
    assert.equal(normalizeAppRole(role), "admin");
    assert.ok(Object.values(getDefaultPermissionsByRole(role)).every((level) => level === "edit"));
  }
  assert.equal(isOwnerTeamRole("administrator"), false);
  assert.equal(isCeoMembershipRole("administrator"), false);
  assert.equal(canAssignTeamRole("admin", "owner"), true);
  assert.equal(canAssignTeamRole("owner", "owner"), true);
  assert.equal(canAssignTeamRole("pm", "owner"), false);
  assert.equal(canAssignTeamRole("manager", "owner"), false);
  assert.equal(canAssignTeamRole("pm", "administrator"), true);
});

test("multiple Owner-role members use the same protected access role", () => {
  const companyMemberships = ["owner", "owner"];
  assert.equal(companyMemberships.filter(isOwnerTeamRole).length, 2);
  assert.ok(companyMemberships.every((role) => normalizeAppRole(role) === "admin"));
});

test("every new invitation role uses one creation and acceptance contract", () => {
  const expectedProfiles = {
    owner: "admin",
    administrator: "pm",
    manager: "pm",
    crew_lead: "foreman",
    team_member: "operator",
  } as const;

  for (const [role, profile] of Object.entries(expectedProfiles)) {
    const created = canonicalizeRoleWrite(role);
    const accepted = {
      role: normalizeCanonicalTeamRole(created.role),
      legacy_permission_profile: normalizeLegacyPermissionProfile(
        created.role,
        created.legacy_permission_profile
      ),
    };
    const normalized = normalizePermissionPayload({ role, permissions: [] });
    assert.equal(normalized.role, role);
    assert.deepEqual(created, accepted);
    assert.equal(created.legacy_permission_profile, profile);
  }
});

test("legacy invite and cached native values remain accepted without escalation", () => {
  assert.equal(normalizeCanonicalTeamRole("foreman"), "crew_lead");
  assert.equal(normalizeCanonicalTeamRole("field_staff"), "team_member");
  assert.equal(normalizeAppRole("team_member", "mechanic"), "mechanic");
  assert.equal(normalizeAppRole("team_member", "fieldstaff"), "operator");
  assert.equal(canonicalizeRoleWrite("admin").role, "owner");
  assert.equal(canonicalizeRoleWrite("administrator").role, "administrator");
  assert.equal(legacyCompatibleRoleValue("owner", "memberships"), "admin");
  assert.equal(legacyCompatibleRoleValue("owner", "pending_invitations"), "ceo");
  assert.equal(legacyCompatibleRoleValue("administrator", "employees"), "pm");
  assert.equal(legacyCompatibleRoleValue("administrator", "pending_invitations"), "manager");
  assert.equal(legacyCompatibleRoleValue("crew_lead", "invite_tokens"), "foreman");
  assert.equal(legacyCompatibleRoleValue("team_member", "pending_invitations"), "operator");
  assert.equal(legacyCompatibleRoleValue("fieldstaff", "memberships"), "operator");
  assert.equal(legacyCompatibleRoleValue("fieldstaff", "pending_invitations"), "fieldstaff");
});

test("normal role labels contain no legacy trade-specific authorization names", () => {
  assert.equal(canonicalTeamRoleLabel("ceo"), "Owner");
  assert.equal(canonicalTeamRoleLabel("foreman"), "Crew Lead");
  assert.equal(canonicalTeamRoleLabel("mechanic"), "Team Member");
  assert.equal(canonicalTeamRoleLabel("operator"), "Team Member");
  assert.equal(canonicalTeamRoleLabel("fieldstaff"), "Team Member");
});
