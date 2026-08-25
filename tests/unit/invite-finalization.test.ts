import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  decideExistingCompany,
  decideExistingInviteMembership,
  inviteIdentityMatches,
  inviteRoleContract,
  membershipRoleMatchesInvite,
  resolveVerifiedAuthEmail,
  verifyInviteFinalizationRows,
} from "../../src/lib/auth/inviteFinalization.ts";

const inviteCreatedAt = "2026-08-11T12:00:00.000Z";

test("new invitee proceeds without an existing membership", () => {
  assert.deepEqual(
    decideExistingInviteMembership({
      userId: "invitee",
      invitedBy: "owner",
      inviteRole: "manager",
      inviteCreatedAt,
      acceptedAt: null,
      acceptedUserId: null,
      membership: null,
    }),
    { kind: "new_membership" }
  );
});

test("legacy invite roles preserve their post-migration permission profiles", () => {
  const cases = [
    ["ceo", "co_owner", "admin"],
    ["Co-CEO", "co_owner", "admin"],
    ["admin", "co_owner", "admin"],
    ["executive", "co_owner", "admin"],
    ["PM", "manager", "pm"],
    ["project manager", "manager", "pm"],
    ["foreman", "crew_lead", "foreman"],
    ["mechanic", "team_member", "mechanic"],
    ["operator", "team_member", "operator"],
    ["fieldstaff", "team_member", "fieldstaff"],
  ] as const;
  for (const [legacy, role, permissionProfile] of cases) {
    assert.deepEqual(inviteRoleContract(legacy), { role, permissionProfile });
  }
});

test("canonical invite roles use their deliberate conservative profiles", () => {
  const cases = [
    ["owner", "owner", "admin"],
    ["co_owner", "co_owner", "admin"],
    ["administrator", "administrator", "pm"],
    ["manager", "manager", "pm"],
    ["crew_lead", "crew_lead", "foreman"],
    ["team_member", "team_member", "operator"],
  ] as const;
  for (const [input, role, permissionProfile] of cases) {
    assert.deepEqual(inviteRoleContract(input), { role, permissionProfile });
  }
});

test("explicit legacy profile survives on a canonical invitation", () => {
  assert.deepEqual(inviteRoleContract("team_member", "fieldstaff"), {
    role: "team_member",
    permissionProfile: "fieldstaff",
  });
});

test("Administrator is not equivalent to Owner", () => {
  assert.equal(membershipRoleMatchesInvite("administrator", "owner", "pm", "admin"), false);
  assert.equal(membershipRoleMatchesInvite("administrator", "manager", "pm", "pm"), false);
});

test("membership created after the invite with exact role and profile resumes finalization", () => {
  assert.deepEqual(
    decideExistingInviteMembership({
      userId: "invitee",
      invitedBy: "owner",
      inviteRole: "ceo",
      invitePermissionProfile: "admin",
      inviteCreatedAt,
      acceptedAt: null,
      acceptedUserId: null,
      membership: {
        role: "co_owner",
        permissionProfile: "admin",
        createdAt: "2026-08-11T12:00:01.000Z",
      },
    }),
    { kind: "resume_partial" }
  );
});

test("legacy partial membership is compatible with its canonicalized invitation", () => {
  assert.equal(
    decideExistingInviteMembership({
      userId: "invitee",
      invitedBy: "owner",
      inviteRole: "PM",
      inviteCreatedAt,
      acceptedAt: null,
      acceptedUserId: null,
      membership: {
        role: "manager",
        permissionProfile: "pm",
        createdAt: "2026-08-11T12:00:01.000Z",
      },
    }).kind,
    "resume_partial"
  );
});

test("same canonical role with a different legacy profile cannot resume", () => {
  assert.equal(
    decideExistingInviteMembership({
      userId: "invitee",
      invitedBy: "owner",
      inviteRole: "fieldstaff",
      inviteCreatedAt,
      acceptedAt: null,
      acceptedUserId: null,
      membership: {
        role: "team_member",
        permissionProfile: "operator",
        createdAt: "2026-08-11T12:00:01.000Z",
      },
    }).kind,
    "already_member"
  );
});

test("retry after completed finalization is idempotent for the accepted user", () => {
  assert.deepEqual(
    decideExistingInviteMembership({
      userId: "invitee",
      invitedBy: "owner",
      inviteRole: "owner",
      inviteCreatedAt,
      acceptedAt: "2026-08-11T12:00:05.000Z",
      acceptedUserId: "invitee",
      membership: {
        role: "owner",
        permissionProfile: "admin",
        createdAt: "2026-08-11T12:00:01.000Z",
      },
    }),
    { kind: "already_finalized" }
  );
});

test("owner-session protection wins even when the role matches", () => {
  assert.equal(
    decideExistingInviteMembership({
      userId: "owner",
      invitedBy: "owner",
      inviteRole: "owner",
      inviteCreatedAt,
      acceptedAt: null,
      acceptedUserId: null,
      membership: {
        role: "owner",
        permissionProfile: "admin",
        createdAt: "2026-08-11T12:00:01.000Z",
      },
    }).kind,
    "owner_session"
  );
});

test("pre-existing Owner membership cannot consume a new Owner invite", () => {
  assert.equal(
    decideExistingInviteMembership({
      userId: "another-owner",
      invitedBy: "owner",
      inviteRole: "owner",
      inviteCreatedAt,
      acceptedAt: null,
      acceptedUserId: null,
      membership: {
        role: "owner",
        permissionProfile: "admin",
        createdAt: "2026-08-10T12:00:00.000Z",
      },
    }).kind,
    "owner_session"
  );
});

test("lower-role member cannot use an Owner invite to escalate", () => {
  assert.equal(
    decideExistingInviteMembership({
      userId: "manager-user",
      invitedBy: "owner",
      inviteRole: "owner",
      inviteCreatedAt,
      acceptedAt: null,
      acceptedUserId: null,
      membership: {
        role: "manager",
        permissionProfile: "pm",
        createdAt: "2026-08-11T12:00:01.000Z",
      },
    }).kind,
    "already_member"
  );
});

test("an unrelated company membership cannot be replaced by invite acceptance", () => {
  assert.deepEqual(
    decideExistingCompany({
      existingCompanyId: "company-a",
      invitedCompanyId: "company-b",
      isDisposableBootstrapCompany: false,
    }),
    {
      kind: "wrong_company",
      status: 409,
      message: "User already belongs to another company",
    }
  );
});

test("only the disposable first-company bootstrap can be replaced", () => {
  assert.equal(
    decideExistingCompany({
      existingCompanyId: "bootstrap-company",
      invitedCompanyId: "invited-company",
      isDisposableBootstrapCompany: true,
    }).kind,
    "detach_disposable_bootstrap"
  );
});

test("same-contract membership that predates the invite is not mistaken for partial acceptance", () => {
  assert.equal(
    decideExistingInviteMembership({
      userId: "team-user",
      invitedBy: "owner",
      inviteRole: "team_member",
      inviteCreatedAt,
      acceptedAt: null,
      acceptedUserId: null,
      membership: {
        role: "team_member",
        permissionProfile: "operator",
        createdAt: "2026-08-01T12:00:00.000Z",
      },
    }).kind,
    "already_member"
  );
});

test("legacy email-bound invite rejects the wrong authenticated email", () => {
  assert.equal(
    inviteIdentityMatches({
      inviteEmail: "invited@example.com",
      authenticatedEmail: "wrong@example.com",
    }),
    false
  );
  assert.equal(
    inviteIdentityMatches({
      inviteEmail: "Invited@Example.com",
      authenticatedEmail: "invited@example.com",
    }),
    true
  );
});

test("token-only invite accepts the verified authenticated identity", () => {
  assert.equal(
    inviteIdentityMatches({ inviteEmail: null, authenticatedEmail: "user@example.com" }),
    true
  );
});

test("Apple and Google identity fallbacks use verified provider identity data", () => {
  assert.equal(
    resolveVerifiedAuthEmail({
      email: null,
      identities: [{ identity_data: { provider: "apple", email: "Apple.Relay@Example.com" } }],
    }),
    "apple.relay@example.com"
  );
  assert.equal(
    resolveVerifiedAuthEmail({
      identities: [{ identity_data: { provider: "google", email: "Google.User@Example.com" } }],
    }),
    "google.user@example.com"
  );
});

test("final state requires exactly one membership and employee with the authorized contract", () => {
  assert.deepEqual(
    verifyInviteFinalizationRows({
      inviteRole: "ceo",
      invitePermissionProfile: "admin",
      memberships: [{ role: "co_owner", legacy_permission_profile: "admin" }],
      employees: [{ role: "co_owner", legacy_permission_profile: "admin" }],
    }),
    { ok: true }
  );
  assert.equal(
    verifyInviteFinalizationRows({
      inviteRole: "owner",
      invitePermissionProfile: "admin",
      memberships: [
        { role: "owner", legacy_permission_profile: "admin" },
        { role: "owner", legacy_permission_profile: "admin" },
      ],
      employees: [{ role: "owner", legacy_permission_profile: "admin" }],
    }).ok,
    false
  );
  assert.equal(
    verifyInviteFinalizationRows({
      inviteRole: "team_member",
      invitePermissionProfile: "fieldstaff",
      memberships: [{ role: "team_member", legacy_permission_profile: "fieldstaff" }],
      employees: [{ role: "team_member", legacy_permission_profile: "operator" }],
    }).ok,
    false
  );
});

test("all web, OAuth, and native provider paths call the same accept endpoint", () => {
  const sources = [
    readFileSync("app/login/page.tsx", "utf8"),
    readFileSync("app/signup/page.tsx", "utf8"),
    readFileSync("app/auth/callback/route.ts", "utf8"),
    readFileSync("src/lib/auth/loginFlow.ts", "utf8"),
  ];
  for (const source of sources) assert.match(source, /\/api\/invite\/accept/);
});

test("accept endpoint writes and verifies canonical role plus permission profile", () => {
  const source = readFileSync("app/api/invite/accept/route.ts", "utf8");
  assert.match(source, /role: resolvedRole/);
  assert.match(source, /legacy_permission_profile: resolvedPermissionProfile/);
  assert.match(source, /select\("role, legacy_permission_profile"\)/);
  assert.match(source, /invited_by: legacyInvitation\.data\.created_by/);
});

test("accept endpoint finalizes pending only after records, permissions, and invariants", () => {
  const source = readFileSync("app/api/invite/accept/route.ts", "utf8");
  const membership = source.indexOf("let upsertMembership");
  const invariant = source.indexOf("const finalizationInvariant = verifyInviteFinalizationRows");
  const permissionTransfer = source.indexOf("replacedUserPermissions = true");
  const pendingFinalization = source.indexOf(
    '.from("pending_invitations")\n          .update({ accepted_at'
  );
  assert.ok(membership >= 0);
  assert.ok(invariant > membership);
  assert.ok(permissionTransfer > invariant);
  assert.ok(pendingFinalization > permissionTransfer);
});

test("accept endpoint compensates records and explicit permissions on failure", () => {
  const source = readFileSync("app/api/invite/accept/route.ts", "utf8");
  assert.match(source, /rollbackMembershipOnFailure/);
  assert.match(source, /employeeBeforeUpdate/);
  assert.match(source, /priorUserPermissions/);
  assert.match(source, /replacedUserPermissions/);
});

test("Team roster refreshes accepted invitations without a manual reload", () => {
  const source = readFileSync("app/page.tsx", "utf8");
  assert.match(source, /Promise\.all\(\[loadTeamItems\(\), loadPendingInvites\(\)\]\)/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /window\.setInterval\(refreshInviteState/);
});
