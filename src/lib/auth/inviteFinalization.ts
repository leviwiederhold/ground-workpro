import {
  canonicalizeRoleWrite,
  isOwnerTeamRole,
  normalizeCanonicalTeamRole,
  normalizeLegacyPermissionProfile,
  type CanonicalTeamRole,
  type LegacyPermissionProfile,
} from "./teamRoles.ts";

export type CanonicalInviteRole = CanonicalTeamRole;

type InviteRoleContract = {
  role: CanonicalTeamRole;
  permissionProfile: LegacyPermissionProfile;
};

export function normalizeInviteRole(value: unknown): CanonicalInviteRole {
  return normalizeCanonicalTeamRole(value) ?? "team_member";
}

export function inviteRoleContract(
  value: unknown,
  explicitPermissionProfile?: unknown
): InviteRoleContract {
  const role = normalizeInviteRole(value);
  const permissionProfile =
    normalizeLegacyPermissionProfile(value, explicitPermissionProfile) ??
    canonicalizeRoleWrite(role).legacy_permission_profile;
  return { role, permissionProfile };
}

export function membershipRoleForInvite(value: unknown): CanonicalTeamRole {
  return inviteRoleContract(value).role;
}

export function employeeRoleForInvite(value: unknown): CanonicalTeamRole {
  return inviteRoleContract(value).role;
}

export function membershipRoleMatchesInvite(
  actualRole: unknown,
  inviteRole: unknown,
  actualPermissionProfile?: unknown,
  invitePermissionProfile?: unknown
): boolean {
  const actual = inviteRoleContract(actualRole, actualPermissionProfile);
  const invited = inviteRoleContract(inviteRole, invitePermissionProfile);
  return actual.role === invited.role && actual.permissionProfile === invited.permissionProfile;
}

type AuthIdentity = {
  identity_data?: Record<string, unknown> | null;
};

export function resolveVerifiedAuthEmail(user: {
  email?: string | null;
  identities?: AuthIdentity[] | null;
  user_metadata?: Record<string, unknown> | null;
}): string {
  const candidates = [
    user.email,
    ...(user.identities ?? []).map((identity) => identity.identity_data?.email),
    user.user_metadata?.email,
  ];
  for (const candidate of candidates) {
    const email = String(candidate ?? "")
      .trim()
      .toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return email;
  }
  return "";
}

export type ExistingMembershipDecision =
  | { kind: "new_membership" }
  | { kind: "resume_partial" }
  | { kind: "already_finalized" }
  | { kind: "owner_session"; status: 409; message: string }
  | { kind: "already_member"; status: 409; message: string };

export type ExistingCompanyDecision =
  | { kind: "same_company" }
  | { kind: "no_company" }
  | { kind: "detach_disposable_bootstrap" }
  | { kind: "wrong_company"; status: 409; message: string };

export function decideExistingCompany(input: {
  existingCompanyId: string | null;
  invitedCompanyId: string;
  isDisposableBootstrapCompany: boolean;
}): ExistingCompanyDecision {
  if (!input.existingCompanyId) return { kind: "no_company" };
  if (input.existingCompanyId === input.invitedCompanyId) return { kind: "same_company" };
  if (input.isDisposableBootstrapCompany) return { kind: "detach_disposable_bootstrap" };
  return {
    kind: "wrong_company",
    status: 409,
    message: "User already belongs to another company",
  };
}

/**
 * Decide whether an existing invited-company membership is a resumable write
 * from this invite or an unrelated pre-existing membership that must remain
 * protected. A pending, token-only invite is not enough to promote an existing
 * Team Member: the membership must already have the exact authorized canonical
 * role and legacy permission profile, and must have been created no earlier
 * than the invite.
 */
export function decideExistingInviteMembership(input: {
  userId: string;
  invitedBy: string | null;
  inviteRole: unknown;
  invitePermissionProfile?: unknown;
  inviteCreatedAt: string | null;
  acceptedAt: string | null;
  acceptedUserId: string | null;
  membership: {
    role: unknown;
    permissionProfile?: unknown;
    createdAt: string | null;
  } | null;
}): ExistingMembershipDecision {
  if (input.acceptedAt && input.acceptedUserId === input.userId) {
    return { kind: "already_finalized" };
  }
  if (!input.membership) return { kind: "new_membership" };

  const currentIsOwner = isOwnerTeamRole(input.membership.role);
  const ownerMessage =
    "You're signed in as the company Owner. Open this invite in a different browser or sign out to accept as a new Team Member.";
  const memberMessage =
    "You're already a member of this company. Open this invite in a different browser, or sign out and accept with the invited Team Member's own account.";

  if (input.invitedBy && input.invitedBy === input.userId) {
    return { kind: "owner_session", status: 409, message: ownerMessage };
  }
  if (
    !membershipRoleMatchesInvite(
      input.membership.role,
      input.inviteRole,
      input.membership.permissionProfile,
      input.invitePermissionProfile
    )
  ) {
    return currentIsOwner
      ? { kind: "owner_session", status: 409, message: ownerMessage }
      : { kind: "already_member", status: 409, message: memberMessage };
  }

  const membershipCreated = Date.parse(String(input.membership.createdAt ?? ""));
  const inviteCreated = Date.parse(String(input.inviteCreatedAt ?? ""));
  if (
    Number.isFinite(membershipCreated) &&
    Number.isFinite(inviteCreated) &&
    membershipCreated >= inviteCreated
  ) {
    return { kind: "resume_partial" };
  }

  return currentIsOwner
    ? { kind: "owner_session", status: 409, message: ownerMessage }
    : { kind: "already_member", status: 409, message: memberMessage };
}

export function inviteIdentityMatches(input: {
  inviteEmail: string | null | undefined;
  authenticatedEmail: string;
}): boolean {
  const inviteEmail = String(input.inviteEmail ?? "")
    .trim()
    .toLowerCase();
  return !inviteEmail || inviteEmail === input.authenticatedEmail;
}

export function verifyInviteFinalizationRows(input: {
  inviteRole: unknown;
  invitePermissionProfile?: unknown;
  memberships: Array<{ role: unknown; legacy_permission_profile?: unknown }>;
  employees: Array<{ role: unknown; legacy_permission_profile?: unknown }>;
}): { ok: true } | { ok: false; error: string } {
  if (input.memberships.length !== 1) {
    return { ok: false, error: "Invite finalization requires exactly one company membership" };
  }
  if (
    !membershipRoleMatchesInvite(
      input.memberships[0]?.role,
      input.inviteRole,
      input.memberships[0]?.legacy_permission_profile,
      input.invitePermissionProfile
    )
  ) {
    return { ok: false, error: "Invite membership role does not match the authorized role" };
  }
  if (input.employees.length !== 1) {
    return { ok: false, error: "Invite finalization requires exactly one linked employee record" };
  }
  if (
    !membershipRoleMatchesInvite(
      input.employees[0]?.role,
      input.inviteRole,
      input.employees[0]?.legacy_permission_profile,
      input.invitePermissionProfile
    )
  ) {
    return { ok: false, error: "Invite employee role does not match the authorized role" };
  }
  return { ok: true };
}
