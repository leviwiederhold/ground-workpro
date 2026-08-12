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
  client: NonNullable<ReturnType<typeof getSupabaseAdmin>> | Awaited<ReturnType<typeof supabaseServer>>,
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

  const company = await client
    .from("companies")
    .select("name")
    .eq("id", companyId)
    .maybeSingle();
  if (company.error) return false;

  const companyName = String(company.data?.name ?? "").trim().toLowerCase();
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
    const email = String(authData.user.email ?? "").trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ error: "Invite email not found" }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    const client = admin ?? supabase;

    const existingMembership = await client
      .from("memberships")
      .select("*")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
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
        return NextResponse.json({ item: { success: true, company_id: existingMembership.data.company_id } });
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
          invited_by: null,
        }
        : null;

    if (!invitationData) {
      return NextResponse.json({ error: "Invalid invite token" }, { status: 404 });
    }
    if (invitationData.used_at) {
      return NextResponse.json({ error: "Invite already used" }, { status: 409 });
    }
    if (invitationData.expires_at && new Date(invitationData.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: "Invite expired" }, { status: 410 });
    }

    // New invite flow: the invite carries NO email — the employee supplies their
    // own at signup, so we accept whatever authenticated user opened the link.
    // Legacy invites that DO carry an email must still match the signed-in user.
    const tokenEmail = String(invitationData.email ?? "").trim().toLowerCase();
    if (tokenEmail && tokenEmail !== email) {
      return NextResponse.json({ error: "Invite email does not match signed-in user" }, { status: 403 });
    }

    // SECURITY: a user who already belongs to the invited company cannot accept
    // an invite as a new team member. This blocks the critical "owner/admin opened
    // the invite link in their own browser" case, which would otherwise reuse
    // and OVERWRITE the owner's membership/role. The invitee must accept from
    // their own account in a separate session.
    const membershipInInvitedCompany = await client
      .from("memberships")
      .select("role")
      .eq("company_id", invitationData.company_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!membershipInInvitedCompany.error && membershipInInvitedCompany.data) {
      if (isCeoMembershipRole(membershipInInvitedCompany.data.role)) {
        return NextResponse.json(
          {
            error: "owner_session",
            message:
              "You're signed in as the company Owner. Open this invite in a different browser or sign out to accept as a new Team Member.",
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        {
          error: "already_member",
          message:
            "You're already a member of this company. Open this invite in a different browser, or sign out and accept with the invited Team Member's own account.",
        },
        { status: 409 }
      );
    }

    if (existingMembership.data?.company_id) {
      const existingCompanyId = String(existingMembership.data.company_id);
      const invitedCompanyId = String(invitationData.company_id);
      if (existingCompanyId !== invitedCompanyId) {
        const disposableBootstrapCompany = await isDisposableBootstrapCompany(client, existingCompanyId, userId);
        if (!disposableBootstrapCompany) {
          return NextResponse.json({ error: "User already belongs to another company" }, { status: 409 });
        }

        const detachMembership = await client
          .from("memberships")
          .delete()
          .eq("company_id", existingCompanyId)
          .eq("user_id", userId);
        if (detachMembership.error) {
          return NextResponse.json({ error: detachMembership.error.message }, { status: 400 });
        }

        await client
          .from("module_permissions")
          .delete()
          .eq("company_id", existingCompanyId)
          .eq("user_id", userId);
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
    const ceoUserIds = new Set(
      existingCompanyMemberships
        .filter((row) => isCeoMembershipRole(row.role))
        .map((row) => row.user_id)
    );
    const userIsExistingCeo = ceoUserIds.has(userId);
    const resolvedIsCeo = isOwnerTeamRole(resolvedRole);
    if (!resolvedIsCeo && ceoUserIds.size === 0) {
      return NextResponse.json({ error: "Company must always have at least one Owner membership" }, { status: 409 });
    }
    if (!resolvedIsCeo && userIsExistingCeo && ceoUserIds.size <= 1) {
      return NextResponse.json({ error: "Cannot demote the last Owner membership" }, { status: 409 });
    }

    let upsertMembership = await client
      .from("memberships")
      .upsert(
        {
          company_id: invitationData.company_id,
          user_id: userId,
          role: resolvedRole,
          legacy_permission_profile: resolvedPermissionProfile,
        },
        { onConflict: "company_id,user_id" }
      );
    if (isMissingLegacyPermissionProfileColumn(upsertMembership.error)) {
      upsertMembership = await client
        .from("memberships")
        .upsert(
          {
            company_id: invitationData.company_id,
            user_id: userId,
            role: legacyCompatibleRoleValue(
              resolvedPermissionProfile,
              "memberships"
            ),
          },
          { onConflict: "company_id,user_id" }
        );
    }
    if (upsertMembership.error) {
      return NextResponse.json({ error: upsertMembership.error.message }, { status: 400 });
    }

    try {
      await ensureCompanyHasAtLeastOneCeoMembership(client, String(invitationData.company_id));
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to enforce Owner role" }, { status: 409 });
    }

    // Prefer the name the employee typed on the invite-acceptance form, then
    // fall back to anything captured in auth user_metadata at signup.
    const rawProfileName = String(
      parsed.data.full_name ??
        authData.user.user_metadata?.full_name ??
        authData.user.user_metadata?.name ??
        ""
    ).trim();
    const profileName = rawProfileName ? sanitizeProfileFullName(rawProfileName, email) : "";
    const inviteJobTitle = String(invitationData.job_title ?? "").trim();
    const profilePayload: Record<string, unknown> = {
      id: userId,
    };
    if (profileName) {
      profilePayload.full_name = profileName;
    }
    const profileUpsert = await upsertProfileColumns({
      supabase: client,
      userId,
      payload: profilePayload,
      selectColumns: ["full_name"],
    });
    if (profileUpsert.error) {
      return NextResponse.json({ error: profileUpsert.error.message }, { status: 400 });
    }

    const employeeRole = resolvedRole;
    const inviteEmail = tokenEmail || email;
    let employeeId = String(invitationData.employee_id ?? "").trim();

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
        const insertResult = await client.from("employees").insert(insertPayload).select("id").maybeSingle();
        if (!insertResult.error && insertResult.data?.id) {
          employeeId = String(insertResult.data.id);
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
          insertPayload.role = legacyCompatibleRoleValue(
            resolvedPermissionProfile,
            "employees"
          );
          continue;
        }
        if (!isMissingSchemaError(message)) {
          return NextResponse.json({ error: message || "Failed to create employee record" }, { status: 400 });
        }
        const missingColumn = parseMissingColumn(message);
        if (!missingColumn || !(missingColumn in insertPayload)) {
          return NextResponse.json({ error: message || "Failed to create employee record" }, { status: 400 });
        }
        delete insertPayload[missingColumn];
      }
    }

    if (!employeeId) {
      return NextResponse.json({ error: "Failed to resolve employee record for invite" }, { status: 400 });
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
        .eq("company_id", invitationData.company_id);
      if (!employeeUpdate.error) break;
      const message = employeeUpdate.error.message ?? "";
      if (/role/i.test(message) && /check constraint/i.test(message)) {
        employeeUpdatePayload.role = legacyCompatibleRoleValue(
          resolvedPermissionProfile,
          "employees"
        );
        continue;
      }
      if (!isMissingSchemaError(message)) {
        return NextResponse.json({ error: message }, { status: 400 });
      }
      const missingColumn = parseMissingColumn(message);
      if (!missingColumn || !(missingColumn in employeeUpdatePayload)) {
        return NextResponse.json({ error: message }, { status: 400 });
      }
      delete employeeUpdatePayload[missingColumn];
    }

    const acceptedAt = new Date().toISOString();
    if (invitationData.pending_id) {
      const pendingUse = await client
        .from("pending_invitations")
        .update({ accepted_at: acceptedAt, accepted_user_id: userId })
        .eq("id", invitationData.pending_id)
        .is("accepted_at", null);
      if (pendingUse.error) {
        return NextResponse.json({ error: pendingUse.error.message }, { status: 400 });
      }

      const invitePermissions = await client
        .from("module_permissions")
        .select("module_key, access_level")
        .eq("company_id", invitationData.company_id)
        .eq("invitation_id", invitationData.pending_id);
      if (invitePermissions.error) {
        return NextResponse.json({ error: invitePermissions.error.message }, { status: 400 });
      }

      if ((invitePermissions.data ?? []).length > 0) {
        await client
          .from("module_permissions")
          .delete()
          .eq("company_id", invitationData.company_id)
          .eq("user_id", userId);
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
          return NextResponse.json({ error: userPermissionInsert.error.message }, { status: 400 });
        }
      }
    } else {
      const tokenUse = await client
        .from("invite_tokens")
        .update({ used_at: acceptedAt })
        .eq("token", inviteToken)
        .is("used_at", null);
      if (tokenUse.error) {
        return NextResponse.json({ error: tokenUse.error.message }, { status: 400 });
      }
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
      console.error("[invite/accept] stripe quantity sync error:", syncErr instanceof Error ? syncErr.message : syncErr);
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
