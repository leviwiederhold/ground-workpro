import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  ensureCompanyHasAtLeastOneCeoMembership,
  isCeoMembershipRole,
  listCompanyMembershipRoles,
} from "@/lib/auth/ceoGuard";
import { upsertProfileColumns } from "@/lib/user/profileRecord";
import { sanitizeProfileFullName } from "@/lib/user/profileFields";
import { syncStripeQuantityForCompany } from "@/lib/billing/syncStripeQuantity";
import {
  canonicalizeRoleWrite,
  isMissingLegacyPermissionProfileColumn,
  isOwnerTeamRole,
  legacyCompatibleRoleValue,
  normalizeCanonicalTeamRole,
  normalizeLegacyPermissionProfile,
} from "@/lib/auth/teamRoles";
import {
  decideExistingCompany,
  decideExistingInviteMembership,
  inviteIdentityMatches,
  resolveVerifiedAuthEmail,
  verifyInviteFinalizationRows,
} from "@/lib/auth/inviteFinalization";

const COMPANY_OWNER_MEMBERSHIP_ROLE = "owner";

const bodySchema = z.object({
  role: z.string().optional(),
  email: z.string().email().optional(),
  employeeId: z.string().uuid().optional(),
  token: z.string().min(20).optional(),
  // Employee-provided identity (new invite flow collects this at acceptance).
  full_name: z.string().trim().max(160).optional(),
});

type PendingInvitationRow = {
  id: string;
  company_id: string;
  employee_id?: string | null;
  role?: string | null;
  legacy_permission_profile?: string | null;
  email?: string | null;
  job_title?: string | null;
  accepted_at?: string | null;
  accepted_user_id?: string | null;
  expires_at?: string | null;
  invited_by?: string | null;
  created_at?: string | null;
};

const toValidationError = (issues: { path: (string | number)[]; message: string }[]) => ({
  error: "Validation error",
  details: issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  })),
});

const isMissingSchemaError = (message: string | undefined) =>
  /(column .* does not exist|Could not find the '.*' column|relation .* does not exist|Could not find the table)/i.test(
    message ?? ""
  );

const parseMissingColumn = (message: string | undefined): string | null => {
  if (!message) return null;
  const quoted = message.match(/Could not find the '([^']+)' column/i);
  if (quoted?.[1]) return quoted[1];
  const relation = message.match(/column "?([a-zA-Z0-9_]+)"? of relation/i);
  if (relation?.[1]) return relation[1];
  const generic = message.match(/column "?([a-zA-Z0-9_]+)"? does not exist/i);
  if (generic?.[1]) return generic[1];
  return null;
};

const isDisposableBootstrapCompany = async (
  client:
    | NonNullable<ReturnType<typeof getSupabaseAdmin>>
    | Awaited<ReturnType<typeof supabaseServer>>,
  companyId: string,
  userId: string
) => {
  const memberships = await client
    .from("memberships")
    .select("user_id")
    .eq("company_id", companyId);
  if (memberships.error) return false;
  const membershipUserIds = (memberships.data ?? [])
    .map((row) => String(row.user_id ?? "").trim())
    .filter(Boolean);
  if (membershipUserIds.length !== 1 || membershipUserIds[0] !== userId) return false;

  const company = await client.from("companies").select("name").eq("id", companyId).maybeSingle();
  if (company.error) return false;

  const companyName = String(company.data?.name ?? "")
    .trim()
    .toLowerCase();
  return companyName === "my first company";
};

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(toValidationError(parsed.error.issues), { status: 422 });
    }

    const supabase = await supabaseServer();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const userId = authData.user.id;
    let email = resolveVerifiedAuthEmail(authData.user);

    const admin = getSupabaseAdmin();
    const client = admin ?? supabase;

    let existingMembership = await client
      .from("memberships")
      .select("*")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    if (
      existingMembership.error &&
      /created_at|Could not find the 'created_at' column/i.test(
        existingMembership.error.message || ""
      )
    ) {
      existingMembership = (await client
        .from("memberships")
        .select("company_id, role")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle()) as typeof existingMembership;
    }
    if (existingMembership.error) {
      return NextResponse.json({ error: existingMembership.error.message }, { status: 400 });
    }

    const inviteToken = String(parsed.data.token ?? "").trim();
    if (!inviteToken) {
      if (existingMembership.data?.company_id) {
        const existingCompanyId = String(existingMembership.data.company_id);
        try {
          await ensureCompanyHasAtLeastOneCeoMembership(client, existingCompanyId);
        } catch {
          await client
            .from("memberships")
            .update({ role: COMPANY_OWNER_MEMBERSHIP_ROLE })
            .eq("company_id", existingCompanyId)
            .eq("user_id", userId);
        }
        return NextResponse.json({
          item: { success: true, company_id: existingMembership.data.company_id },
        });
      }
      return NextResponse.json({ error: "Invite token is required" }, { status: 422 });
    }

    const pendingInvitation = await client
      .from("pending_invitations")
      .select("*")
      .eq("invite_token", inviteToken)
      .limit(1)
      .maybeSingle<PendingInvitationRow>();
    if (pendingInvitation.error) {
      return NextResponse.json({ error: pendingInvitation.error.message }, { status: 400 });
    }

    const legacyInvitation = !pendingInvitation.data
      ? await client
          .from("invite_tokens")
          .select("*")
          .eq("token", inviteToken)
          .limit(1)
          .maybeSingle()
      : null;
    if (legacyInvitation?.error) {
      return NextResponse.json({ error: legacyInvitation.error.message }, { status: 400 });
    }

    const invitationData = pendingInvitation.data
      ? {
          company_id: pendingInvitation.data.company_id,
          employee_id: pendingInvitation.data.employee_id,
          role: pendingInvitation.data.role,
          legacy_permission_profile: pendingInvitation.data.legacy_permission_profile,
          email: pendingInvitation.data.email,
          job_title: pendingInvitation.data.job_title ?? null,
          used_at: pendingInvitation.data.accepted_at,
          expires_at: pendingInvitation.data.expires_at,
          pending_id: pendingInvitation.data.id,
          invited_by: pendingInvitation.data.invited_by,
          accepted_user_id: pendingInvitation.data.accepted_user_id,
          created_at: pendingInvitation.data.created_at ?? null,
        }
      : legacyInvitation?.data
        ? {
            company_id: legacyInvitation.data.company_id,
            employee_id: legacyInvitation.data.employee_id,
            role: legacyInvitation.data.role,
            legacy_permission_profile: legacyInvitation.data.legacy_permission_profile,
            email: legacyInvitation.data.email,
            job_title: null,
            used_at: legacyInvitation.data.used_at,
            expires_at: legacyInvitation.data.expires_at,
            pending_id: null,
            invited_by: legacyInvitation.data.created_by ?? null,
            accepted_user_id: null,
            created_at: legacyInvitation.data.created_at ?? null,
          }
        : null;

    if (!invitationData) {
      return NextResponse.json({ error: "Invalid invite token" }, { status: 404 });
    }
    const isCompletedRetry = Boolean(
      invitationData.used_at &&
      invitationData.accepted_user_id &&
      String(invitationData.accepted_user_id) === userId
    );
    if (invitationData.used_at && !isCompletedRetry) {
      return NextResponse.json({ error: "Invite already used" }, { status: 409 });
    }
    if (
      !isCompletedRetry &&
      invitationData.expires_at &&
      new Date(invitationData.expires_at).getTime() < Date.now()
    ) {
      return NextResponse.json({ error: "Invite expired" }, { status: 410 });
    }

    if (!email) {
      const linkedEmployee = await client
        .from("employees")
        .select("email")
        .eq("company_id", invitationData.company_id)
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
      if (!linkedEmployee.error) {
        email = String(linkedEmployee.data?.email ?? "")
          .trim()
          .toLowerCase();
      }
    }
    if (!email) {
      return NextResponse.json({ error: "Invite email not found" }, { status: 400 });
    }

    // New invite flow: the invite carries NO email — the employee supplies their
    // own at signup, so we accept whatever authenticated user opened the link.
    // Legacy invites that DO carry an email must still match the signed-in user.
    const tokenEmail = String(invitationData.email ?? "")
      .trim()
      .toLowerCase();
    if (!inviteIdentityMatches({ inviteEmail: tokenEmail, authenticatedEmail: email })) {
      return NextResponse.json(
        { error: "Invite email does not match signed-in user" },
        { status: 403 }
      );
    }

    let membershipInInvitedCompany = await client
      .from("memberships")
      .select("*")
      .eq("company_id", invitationData.company_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (
      membershipInInvitedCompany.error &&
      /created_at|Could not find the 'created_at' column/i.test(
        membershipInInvitedCompany.error.message || ""
      )
    ) {
      membershipInInvitedCompany = (await client
        .from("memberships")
        .select("role")
        .eq("company_id", invitationData.company_id)
        .eq("user_id", userId)
        .maybeSingle()) as typeof membershipInInvitedCompany;
    }
    if (membershipInInvitedCompany.error) {
      return NextResponse.json(
        { error: membershipInInvitedCompany.error.message },
        { status: 400 }
      );
    }

    const membershipDecision = decideExistingInviteMembership({
      userId,
      invitedBy: invitationData.invited_by ? String(invitationData.invited_by) : null,
      inviteRole: invitationData.role,
      inviteCreatedAt: invitationData.created_at ? String(invitationData.created_at) : null,
      invitePermissionProfile: invitationData.legacy_permission_profile,
      acceptedAt: invitationData.used_at ? String(invitationData.used_at) : null,
      acceptedUserId: invitationData.accepted_user_id
        ? String(invitationData.accepted_user_id)
        : null,
      membership: membershipInInvitedCompany.data
        ? {
            role: membershipInInvitedCompany.data.role,
            permissionProfile: membershipInInvitedCompany.data.legacy_permission_profile,
            createdAt: membershipInInvitedCompany.data.created_at
              ? String(membershipInInvitedCompany.data.created_at)
              : null,
          }
        : null,
    });
    if (
      membershipDecision.kind === "owner_session" ||
      membershipDecision.kind === "already_member"
    ) {
      return NextResponse.json(
        { error: membershipDecision.kind, message: membershipDecision.message },
        { status: membershipDecision.status }
      );
    }

    let disposableBootstrapMembership: {
      companyId: string;
      role: string;
      permissionProfile: string | null;
    } | null = null;
    if (existingMembership.data?.company_id) {
      const existingCompanyId = String(existingMembership.data.company_id);
      const invitedCompanyId = String(invitationData.company_id);
      if (existingCompanyId !== invitedCompanyId) {
        const disposableBootstrapCompany = await isDisposableBootstrapCompany(
          client,
          existingCompanyId,
          userId
        );
        const companyDecision = decideExistingCompany({
          existingCompanyId,
          invitedCompanyId,
          isDisposableBootstrapCompany: disposableBootstrapCompany,
        });
        if (companyDecision.kind === "wrong_company") {
          return NextResponse.json(
            { error: companyDecision.message },
            { status: companyDecision.status }
          );
        }
        disposableBootstrapMembership = {
          companyId: existingCompanyId,
          role: String(existingMembership.data.role ?? COMPANY_OWNER_MEMBERSHIP_ROLE),
          permissionProfile: existingMembership.data.legacy_permission_profile
            ? String(existingMembership.data.legacy_permission_profile)
            : null,
        };
      }
    }

    const resolvedRole = normalizeCanonicalTeamRole(invitationData.role) ?? "team_member";
    const resolvedPermissionProfile =
      normalizeLegacyPermissionProfile(
        invitationData.role,
        invitationData.legacy_permission_profile
      ) ?? canonicalizeRoleWrite(resolvedRole).legacy_permission_profile;
    const existingCompanyMemberships = await listCompanyMembershipRoles(
      client,
      String(invitationData.company_id)
    );
    const ownerUserIds = new Set(
      existingCompanyMemberships
        .filter((row) => isCeoMembershipRole(row.role))
        .map((row) => row.user_id)
    );
    const userIsExistingOwner = ownerUserIds.has(userId);
    const resolvedIsOwner = isOwnerTeamRole(resolvedRole);
    if (resolvedIsOwner && invitationData.invited_by) {
      const inviterMembership = existingCompanyMemberships.find(
        (row) => row.user_id === String(invitationData.invited_by)
      );
      if (!inviterMembership || !isCeoMembershipRole(inviterMembership.role)) {
        return NextResponse.json(
          { error: "Owner access was not authorized by a current company Owner." },
          { status: 403 }
        );
      }
    }
    if (!resolvedIsOwner && ownerUserIds.size === 0) {
      return NextResponse.json(
        { error: "Company must always have at least one Owner membership" },
        { status: 409 }
      );
    }
    if (!resolvedIsOwner && userIsExistingOwner && ownerUserIds.size <= 1) {
      return NextResponse.json(
        { error: "Cannot demote the last Owner membership" },
        { status: 409 }
      );
    }

    // Finish profile work before the membership write. A profile alone grants
    // no tenant access, so a failure here cannot produce member+pending state.
    const rawProfileName = String(
      parsed.data.full_name ??
        authData.user.user_metadata?.full_name ??
        authData.user.user_metadata?.name ??
        ""
    ).trim();
    const profileName = rawProfileName ? sanitizeProfileFullName(rawProfileName, email) : "";
    const inviteJobTitle = String(invitationData.job_title ?? "").trim();
    const profilePayload: Record<string, unknown> = { id: userId };
    if (profileName) profilePayload.full_name = profileName;
    const profileUpsert = await upsertProfileColumns({
      supabase: client,
      userId,
      payload: profilePayload,
      selectColumns: ["full_name"],
    });
    if (profileUpsert.error) {
      return NextResponse.json({ error: profileUpsert.error.message }, { status: 400 });
    }

    if (disposableBootstrapMembership) {
      const detachMembership = await client
        .from("memberships")
        .delete()
        .eq("company_id", disposableBootstrapMembership.companyId)
        .eq("user_id", userId);
      if (detachMembership.error) {
        return NextResponse.json({ error: detachMembership.error.message }, { status: 400 });
      }
    }

    let upsertMembership = await client.from("memberships").upsert(
      {
        company_id: invitationData.company_id,
        user_id: userId,
        role: resolvedRole,
        legacy_permission_profile: resolvedPermissionProfile,
      },
      { onConflict: "company_id,user_id" }
    );
    if (isMissingLegacyPermissionProfileColumn(upsertMembership.error)) {
      upsertMembership = await client.from("memberships").upsert(
        {
          company_id: invitationData.company_id,
          user_id: userId,
          role: legacyCompatibleRoleValue(resolvedPermissionProfile, "memberships"),
        },
        { onConflict: "company_id,user_id" }
      );
    }
    if (upsertMembership.error) {
      if (disposableBootstrapMembership) {
        await client.from("memberships").upsert(
          {
            company_id: disposableBootstrapMembership.companyId,
            user_id: userId,
            role: disposableBootstrapMembership.role,
            ...(disposableBootstrapMembership.permissionProfile
              ? {
                  legacy_permission_profile: disposableBootstrapMembership.permissionProfile,
                }
              : {}),
          },
          { onConflict: "company_id,user_id" }
        );
      }
      return NextResponse.json({ error: upsertMembership.error.message }, { status: 400 });
    }

    // A current-version failure after this point is compensated by removing a
    // membership created by this invite. A retry of an older partial write is
    // safe to remove too because decideExistingInviteMembership proved that it
    // has the exact invited role and was created after the invite.
    let createdEmployeeId: string | null = null;
    let employeeBeforeUpdate: Record<string, unknown> | null = null;
    let employeeUpdatedColumns: string[] = [];
    let priorUserPermissions: Array<{
      module_key: string;
      access_level: string;
      created_by: string | null;
    }> | null = null;
    let replacedUserPermissions = false;
    const rollbackMembershipOnFailure =
      membershipDecision.kind === "new_membership" || membershipDecision.kind === "resume_partial";
    const failAfterMembership = async (message: string, status = 400) => {
      if (replacedUserPermissions && priorUserPermissions) {
        await client
          .from("module_permissions")
          .delete()
          .eq("company_id", invitationData.company_id)
          .eq("user_id", userId);
        if (priorUserPermissions.length > 0) {
          await client.from("module_permissions").insert(
            priorUserPermissions.map((row) => ({
              company_id: invitationData.company_id,
              user_id: userId,
              module_key: row.module_key,
              access_level: row.access_level,
              created_by: row.created_by,
            }))
          );
        }
      }
      if (createdEmployeeId) {
        await client
          .from("employees")
          .delete()
          .eq("id", createdEmployeeId)
          .eq("company_id", invitationData.company_id)
          .eq("user_id", userId);
      } else if (employeeBeforeUpdate && employeeUpdatedColumns.length > 0) {
        const restorePayload = Object.fromEntries(
          employeeUpdatedColumns
            .filter((column) => column in employeeBeforeUpdate!)
            .map((column) => [column, employeeBeforeUpdate![column]])
        );
        if (Object.keys(restorePayload).length > 0) {
          await client
            .from("employees")
            .update(restorePayload)
            .eq("id", String(employeeBeforeUpdate.id ?? ""))
            .eq("company_id", invitationData.company_id);
        }
      }
      if (rollbackMembershipOnFailure) {
        await client
          .from("memberships")
          .delete()
          .eq("company_id", invitationData.company_id)
          .eq("user_id", userId);
      }
      if (disposableBootstrapMembership) {
        await client.from("memberships").upsert(
          {
            company_id: disposableBootstrapMembership.companyId,
            user_id: userId,
            role: disposableBootstrapMembership.role,
            ...(disposableBootstrapMembership.permissionProfile
              ? {
                  legacy_permission_profile: disposableBootstrapMembership.permissionProfile,
                }
              : {}),
          },
          { onConflict: "company_id,user_id" }
        );
      }
      return NextResponse.json({ error: message }, { status });
    };

    try {
      await ensureCompanyHasAtLeastOneCeoMembership(client, String(invitationData.company_id));
    } catch (error) {
      return failAfterMembership(
        error instanceof Error ? error.message : "Failed to enforce Owner role",
        409
      );
    }

    const employeeRole = resolvedRole;
    const inviteEmail = tokenEmail || email;
    let employeeId = String(invitationData.employee_id ?? "").trim();

    if (!employeeId) {
      const employeeByUser = await client
        .from("employees")
        .select("id")
        .eq("company_id", invitationData.company_id)
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
      if (!employeeByUser.error && employeeByUser.data?.id) {
        employeeId = String(employeeByUser.data.id);
      }
    }

    if (!employeeId) {
      const employeeByEmail = await client
        .from("employees")
        .select("id")
        .eq("company_id", invitationData.company_id)
        .ilike("email", inviteEmail)
        .limit(1)
        .maybeSingle();
      if (!employeeByEmail.error && employeeByEmail.data?.id) {
        employeeId = String(employeeByEmail.data.id);
      }
    }

    if (!employeeId) {
      const insertPayload: Record<string, unknown> = {
        company_id: invitationData.company_id,
        email: inviteEmail,
        role: employeeRole,
        legacy_permission_profile: resolvedPermissionProfile,
        user_id: userId,
        name: profileName || inviteEmail,
        full_name: profileName || inviteEmail,
        status: "active",
      };
      if (inviteJobTitle) insertPayload.job_title = inviteJobTitle;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const insertResult = await client
          .from("employees")
          .insert(insertPayload)
          .select("id")
          .maybeSingle();
        if (!insertResult.error && insertResult.data?.id) {
          employeeId = String(insertResult.data.id);
          createdEmployeeId = employeeId;
          break;
        }
        const message = insertResult.error?.message ?? "";
        if (/duplicate key|unique/i.test(message)) {
          const existingByEmail = await client
            .from("employees")
            .select("id")
            .eq("company_id", invitationData.company_id)
            .ilike("email", inviteEmail)
            .limit(1)
            .maybeSingle();
          if (!existingByEmail.error && existingByEmail.data?.id) {
            employeeId = String(existingByEmail.data.id);
            break;
          }
        }
        if (/role/i.test(message) && /check constraint/i.test(message)) {
          insertPayload.role = legacyCompatibleRoleValue(resolvedPermissionProfile, "employees");
          continue;
        }
        if (!isMissingSchemaError(message)) {
          return failAfterMembership(message || "Failed to create employee record");
        }
        const missingColumn = parseMissingColumn(message);
        if (!missingColumn || !(missingColumn in insertPayload)) {
          return failAfterMembership(message || "Failed to create employee record");
        }
        delete insertPayload[missingColumn];
      }
    }

    if (!employeeId) {
      return failAfterMembership("Failed to resolve employee record for invite");
    }

    if (!createdEmployeeId) {
      const employeeSnapshot = await client
        .from("employees")
        .select("*")
        .eq("id", employeeId)
        .eq("company_id", invitationData.company_id)
        .maybeSingle();
      if (employeeSnapshot.error || !employeeSnapshot.data) {
        return failAfterMembership(
          employeeSnapshot.error?.message ||
            "Invite employee does not belong to the invited company"
        );
      }
      employeeBeforeUpdate = employeeSnapshot.data as Record<string, unknown>;
    }

    const employeeUpdatePayload: Record<string, unknown> = {
      role: employeeRole,
      legacy_permission_profile: resolvedPermissionProfile,
      user_id: userId,
      email: inviteEmail,
    };
    if (profileName) {
      employeeUpdatePayload.name = profileName;
      employeeUpdatePayload.full_name = profileName;
    }
    if (inviteJobTitle) employeeUpdatePayload.job_title = inviteJobTitle;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const employeeUpdate = await client
        .from("employees")
        .update(employeeUpdatePayload)
        .eq("id", employeeId)
        .eq("company_id", invitationData.company_id)
        .select("id")
        .maybeSingle();
      if (!employeeUpdate.error && employeeUpdate.data?.id) {
        if (!createdEmployeeId) employeeUpdatedColumns = Object.keys(employeeUpdatePayload);
        break;
      }
      if (!employeeUpdate.error) {
        return failAfterMembership("Invite employee does not belong to the invited company");
      }
      const message = employeeUpdate.error.message ?? "";
      if (/role/i.test(message) && /check constraint/i.test(message)) {
        employeeUpdatePayload.role = legacyCompatibleRoleValue(
          resolvedPermissionProfile,
          "employees"
        );
        continue;
      }
      if (!isMissingSchemaError(message)) {
        return failAfterMembership(message);
      }
      const missingColumn = parseMissingColumn(message);
      if (!missingColumn || !(missingColumn in employeeUpdatePayload)) {
        return failAfterMembership(message);
      }
      delete employeeUpdatePayload[missingColumn];
    }

    const [finalMembershipRows, finalEmployeeRows] = await Promise.all([
      client
        .from("memberships")
        .select("role, legacy_permission_profile")
        .eq("company_id", invitationData.company_id)
        .eq("user_id", userId),
      client
        .from("employees")
        .select("role, legacy_permission_profile")
        .eq("company_id", invitationData.company_id)
        .eq("user_id", userId),
    ]);
    if (finalMembershipRows.error || finalEmployeeRows.error) {
      return failAfterMembership(
        finalMembershipRows.error?.message ||
          finalEmployeeRows.error?.message ||
          "Failed to verify invite finalization"
      );
    }
    const finalizationInvariant = verifyInviteFinalizationRows({
      inviteRole: resolvedRole,
      invitePermissionProfile: resolvedPermissionProfile,
      memberships: finalMembershipRows.data ?? [],
      employees: finalEmployeeRows.data ?? [],
    });
    if (!finalizationInvariant.ok) {
      return failAfterMembership(finalizationInvariant.error, 409);
    }

    const acceptedAt = new Date().toISOString();
    if (invitationData.pending_id) {
      const invitePermissions = await client
        .from("module_permissions")
        .select("module_key, access_level")
        .eq("company_id", invitationData.company_id)
        .eq("invitation_id", invitationData.pending_id);
      if (invitePermissions.error) {
        return failAfterMembership(invitePermissions.error.message);
      }

      if ((invitePermissions.data ?? []).length > 0) {
        const existingUserPermissions = await client
          .from("module_permissions")
          .select("module_key, access_level, created_by")
          .eq("company_id", invitationData.company_id)
          .eq("user_id", userId);
        if (existingUserPermissions.error) {
          return failAfterMembership(existingUserPermissions.error.message);
        }
        priorUserPermissions = (existingUserPermissions.data ?? []).map((row) => ({
          module_key: String(row.module_key),
          access_level: String(row.access_level),
          created_by: row.created_by ? String(row.created_by) : null,
        }));
        const removeExistingPermissions = await client
          .from("module_permissions")
          .delete()
          .eq("company_id", invitationData.company_id)
          .eq("user_id", userId);
        if (removeExistingPermissions.error) {
          return failAfterMembership(removeExistingPermissions.error.message);
        }
        replacedUserPermissions = true;
        const userPermissionInsert = await client.from("module_permissions").insert(
          (invitePermissions.data ?? []).map((row) => ({
            company_id: invitationData.company_id,
            user_id: userId,
            module_key: row.module_key,
            access_level: row.access_level,
            created_by: invitationData.invited_by || userId,
          }))
        );
        if (userPermissionInsert.error) {
          return failAfterMembership(userPermissionInsert.error.message);
        }
      }

      // Finalize last. All membership, employee, and permission work is already
      // complete, so the Pending list and Team roster change together. A retry
      // after a lost response is accepted for the same authenticated user.
      if (!isCompletedRetry) {
        const pendingUse = await client
          .from("pending_invitations")
          .update({ accepted_at: acceptedAt, accepted_user_id: userId, email: inviteEmail })
          .eq("id", invitationData.pending_id)
          .is("accepted_at", null)
          .select("id")
          .maybeSingle();
        if (pendingUse.error || !pendingUse.data?.id) {
          const current = await client
            .from("pending_invitations")
            .select("accepted_at, accepted_user_id")
            .eq("id", invitationData.pending_id)
            .maybeSingle();
          const wonBySameUser =
            !current.error &&
            current.data?.accepted_at &&
            String(current.data.accepted_user_id ?? "") === userId;
          if (!wonBySameUser) {
            return failAfterMembership(
              pendingUse.error?.message || "Failed to finalize invitation"
            );
          }
        }
      }
    } else {
      if (!isCompletedRetry) {
        const tokenUse = await client
          .from("invite_tokens")
          .update({ used_at: acceptedAt })
          .eq("token", inviteToken)
          .is("used_at", null);
        if (tokenUse.error) {
          return failAfterMembership(tokenUse.error.message);
        }
      }
    }

    if (disposableBootstrapMembership) {
      await client
        .from("module_permissions")
        .delete()
        .eq("company_id", disposableBootstrapMembership.companyId)
        .eq("user_id", userId);
    }

    // Sync Stripe subscription quantity — seat count increased by 1.
    // Non-fatal: if Stripe isn't configured or the company has no subscription yet,
    // we still let the employee in. Errors are logged server-side.
    try {
      const syncResult = await syncStripeQuantityForCompany(String(invitationData.company_id));
      if (!syncResult.synced) {
        console.warn("[invite/accept] stripe quantity not synced:", syncResult.reason);
      }
    } catch (syncErr) {
      console.error(
        "[invite/accept] stripe quantity sync error:",
        syncErr instanceof Error ? syncErr.message : syncErr
      );
    }

    return NextResponse.json({
      item: {
        success: true,
        company_id: invitationData.company_id,
        role: resolvedRole,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
