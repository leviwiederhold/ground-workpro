import { supabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  ensureCompanyHasAtLeastOneCeoMembership,
  isCeoMembershipRole,
  listCompanyMembershipRoles,
} from "@/lib/auth/ceoGuard";
import {
  canonicalizeRoleWrite,
  isMissingLegacyPermissionProfileColumn,
  legacyCompatibleRoleValue,
  normalizeCanonicalTeamRole,
  normalizeLegacyPermissionProfile,
} from "@/lib/auth/teamRoles";

const COMPANY_OWNER_MEMBERSHIP_ROLE = "owner";

async function resolveAcceptedInviteContext(
  client: NonNullable<ReturnType<typeof getSupabaseAdmin>> | Awaited<ReturnType<typeof supabaseServer>>,
  userId: string,
  email: string
) {
  let pendingInvite = await client
    .from("pending_invitations")
    .select("*")
    .eq("accepted_user_id", userId)
    .not("accepted_at", "is", null)
    .order("accepted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingInvite.error && /accepted_at|accepted_user_id|created_at|Could not find the '.*' column/i.test(pendingInvite.error.message || "")) {
    pendingInvite = await client
      .from("pending_invitations")
      .select("*")
      .ilike("email", email)
      .not("accepted_at", "is", null)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
  }

  if (!pendingInvite.error && pendingInvite.data?.company_id) {
    return {
      companyId: String(pendingInvite.data.company_id),
      employeeId: String(pendingInvite.data.employee_id ?? "").trim() || null,
      role: pendingInvite.data.role,
      legacyPermissionProfile: pendingInvite.data.legacy_permission_profile,
    };
  }

  const legacyInvite = await client
    .from("invite_tokens")
    .select("*")
    .ilike("email", email)
    .not("used_at", "is", null)
    .order("used_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!legacyInvite.error && legacyInvite.data?.company_id) {
    return {
      companyId: String(legacyInvite.data.company_id),
      employeeId: String(legacyInvite.data.employee_id ?? "").trim() || null,
      role: legacyInvite.data.role,
      legacyPermissionProfile: legacyInvite.data.legacy_permission_profile,
    };
  }

  return null;
}

export class TenantResolverError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function getCompanyId() {
  const supabase = await supabaseServer();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    throw new TenantResolverError("Not authenticated", 401);
  }

  // Resolve the user's OWN membership with the service-role client (scoped to
  // this user id). A broken/recursive memberships RLS SELECT policy would make
  // the RLS-scoped read ERROR — which this resolver maps to a 400, and which the
  // route middleware maps to a 403 — producing a blanket failure of every
  // protected API for a valid member. Reading via admin keeps tenancy resolution
  // working regardless of RLS state; it never widens what THIS user can see.
  const membershipReader = getSupabaseAdmin() ?? supabase;
  const loadMembership = async () => {
    const preferred = await membershipReader
      .from("memberships")
      .select("company_id")
      .eq("user_id", userData.user.id)
      .order("created_at", { ascending: false })
      .limit(1);
    if (
      preferred.error &&
      /column memberships\.created_at does not exist|Could not find the 'created_at' column/i.test(
        preferred.error.message || ""
      )
    ) {
      return membershipReader
        .from("memberships")
        .select("company_id")
        .eq("user_id", userData.user.id)
        .order("company_id", { ascending: true })
        .limit(1);
    }
    return preferred;
  };

  let { data: memberships, error: membershipsError } = await loadMembership();

  if (membershipsError) {
    throw new TenantResolverError(membershipsError.message, 400);
  }

  let companyId = memberships?.[0]?.company_id;
  if (!companyId) {
    const email = String(userData.user.email ?? "").trim().toLowerCase();
    if (email) {
      const admin = getSupabaseAdmin();
      const client = admin ?? supabase;
      const acceptedInvite = await resolveAcceptedInviteContext(client, userData.user.id, email);

      let inviteEmployee:
        | {
            error: { message?: string } | null;
            data: { id?: string | null; company_id?: string | null; role?: string | null; legacy_permission_profile?: string | null; user_id?: string | null } | null;
          }
        = { error: null, data: null };

      if (acceptedInvite?.employeeId) {
        const employeeByAcceptedInvite = await client
          .from("employees")
          .select("*")
          .eq("company_id", acceptedInvite.companyId)
          .eq("id", acceptedInvite.employeeId)
          .maybeSingle();
        inviteEmployee = {
          error: employeeByAcceptedInvite.error,
          data: employeeByAcceptedInvite.data,
        };
      }

      if (!inviteEmployee.data) {
        let employeeRows = await client
          .from("employees")
          .select("*")
          .ilike("email", email)
          .order("created_at", { ascending: false })
          .limit(20);

        if (employeeRows.error && /created_at/i.test(employeeRows.error.message || "")) {
          employeeRows = await client
            .from("employees")
            .select("*")
            .ilike("email", email)
            .order("id", { ascending: false })
            .limit(20);
        }

        if (!employeeRows.error) {
          const rows = (employeeRows.data ?? []) as Array<{
            id?: string | null;
            company_id?: string | null;
            role?: string | null;
            legacy_permission_profile?: string | null;
            user_id?: string | null;
          }>;
          const prioritizedRow =
            rows.find((row) => String(row.user_id ?? "").trim() === String(userData.user.id)) ??
            (acceptedInvite
              ? rows.find((row) => String(row.company_id ?? "").trim() === acceptedInvite.companyId)
              : null) ??
            rows[0] ??
            null;
          inviteEmployee = { error: null, data: prioritizedRow };
        } else {
          inviteEmployee = { error: employeeRows.error, data: null };
        }
      }

      if (!inviteEmployee.error && inviteEmployee.data?.company_id) {
        try {
          const sourceRole = acceptedInvite?.role ?? inviteEmployee.data.role;
          const sourcePermissionProfile =
            acceptedInvite?.legacyPermissionProfile ?? inviteEmployee.data.legacy_permission_profile;
          const roleWrite = {
            role: normalizeCanonicalTeamRole(sourceRole) ?? "team_member",
            legacy_permission_profile:
              normalizeLegacyPermissionProfile(sourceRole, sourcePermissionProfile) ??
              canonicalizeRoleWrite(sourceRole).legacy_permission_profile,
          };

          const existingCompanyMemberships = await listCompanyMembershipRoles(
            client,
            String(inviteEmployee.data.company_id)
          );
          const hasCeoMembership = existingCompanyMemberships.some((row) =>
            isCeoMembershipRole(row.role)
          );
          const safeRoleWrite = hasCeoMembership
            ? roleWrite
            : canonicalizeRoleWrite(COMPANY_OWNER_MEMBERSHIP_ROLE);

          let membershipInsert = await client.from("memberships").upsert(
            {
              company_id: inviteEmployee.data.company_id,
              user_id: userData.user.id,
              ...safeRoleWrite,
            },
            { onConflict: "company_id,user_id" }
          );

          if (isMissingLegacyPermissionProfileColumn(membershipInsert.error)) {
            membershipInsert = await client.from("memberships").upsert(
              {
                company_id: inviteEmployee.data.company_id,
                user_id: userData.user.id,
                role: legacyCompatibleRoleValue(
                  safeRoleWrite.legacy_permission_profile,
                  "memberships"
                ),
              },
              { onConflict: "company_id,user_id" }
            );
          }

          if (
            membershipInsert.error &&
            !/duplicate key|unique/i.test(membershipInsert.error.message || "")
          ) {
            throw new TenantResolverError(membershipInsert.error.message || "Failed to create membership", 400);
          }

          let employeeUpdate = await client
            .from("employees")
            .update({ user_id: userData.user.id, ...safeRoleWrite })
            .eq("id", inviteEmployee.data.id)
            .eq("company_id", inviteEmployee.data.company_id);

          if (isMissingLegacyPermissionProfileColumn(employeeUpdate.error)) {
            employeeUpdate = await client
              .from("employees")
              .update({
                user_id: userData.user.id,
                role: legacyCompatibleRoleValue(
                  safeRoleWrite.legacy_permission_profile,
                  "employees"
                ),
              })
              .eq("id", inviteEmployee.data.id)
              .eq("company_id", inviteEmployee.data.company_id);
          }

          if (
            employeeUpdate.error &&
            /Could not find the 'user_id' column/i.test(employeeUpdate.error.message || "")
          ) {
            await client
              .from("employees")
              .update(safeRoleWrite)
              .eq("id", inviteEmployee.data.id)
              .eq("company_id", inviteEmployee.data.company_id);
          }

          await ensureCompanyHasAtLeastOneCeoMembership(
            client,
            String(inviteEmployee.data.company_id)
          );
        } catch (error) {
          throw new TenantResolverError(
            error instanceof Error ? error.message : "Failed to resolve membership",
            400
          );
        }

        const reloaded = await loadMembership();
        memberships = reloaded.data;
        membershipsError = reloaded.error;
        companyId = memberships?.[0]?.company_id;
      }
    }
  }

  if (membershipsError) {
    throw new TenantResolverError(membershipsError.message, 400);
  }

  if (!companyId) {
    // TEMP diagnostic: a 403 here means authenticated but no company membership.
    if (process.env.NODE_ENV !== "production") {
      console.warn("[getCompanyId] 403 denied", {
        userId: userData.user.id,
        localUserFound: true,
        membershipFound: false,
        companyId: null,
        reason: "no_company_membership",
      });
    }
    throw new TenantResolverError("No company workspace found", 403);
  }

  return { supabase, companyId, userId: userData.user.id, userEmail: String(userData.user.email ?? "").trim().toLowerCase() };
}

export async function getOptionalCompanyId() {
  try {
    return await getCompanyId();
  } catch (error) {
    // A 403 from the resolver means "authenticated but no company workspace yet"
    // (brand-new owner / OAuth user before bootstrap). Match on STATUS, not the
    // human-readable message, so wording changes can't reintroduce a redirect
    // loop. Any other error (incl. 401 not-authenticated) propagates.
    if (!(error instanceof TenantResolverError) || error.status !== 403) {
      throw error;
    }

    const supabase = await supabaseServer();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      throw new TenantResolverError("Not authenticated", 401);
    }

    return {
      supabase,
      companyId: null,
      userId: userData.user.id,
      userEmail: String(userData.user.email ?? "").trim().toLowerCase(),
    };
  }
}
