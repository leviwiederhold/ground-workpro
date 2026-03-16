import { supabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  ensureCompanyHasAtLeastOneCeoMembership,
  isCeoMembershipRole,
  listCompanyMembershipRoles,
} from "@/lib/auth/ceoGuard";

const COMPANY_OWNER_MEMBERSHIP_ROLE = "admin";

const normalizeMembershipRole = (value: unknown) => {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "operator";
  if (raw.includes("admin") || raw.includes("executive") || raw.includes("ceo")) return COMPANY_OWNER_MEMBERSHIP_ROLE;
  if (raw === "pm" || raw.includes("operations") || raw.includes("projectmanager") || raw.includes("manager")) return "pm";
  if (raw.includes("foreman")) return "foreman";
  if (raw.includes("mechanic")) return "mechanic";
  return "operator";
};

const normalizeEmployeeRole = (value: unknown) => {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "operator";
  if (raw.includes("admin") || raw.includes("executive") || raw.includes("ceo")) return "admin";
  if (raw === "pm" || raw.includes("operations") || raw.includes("projectmanager") || raw.includes("manager")) return "pm";
  if (raw.includes("foreman")) return "foreman";
  if (raw.includes("mechanic")) return "mechanic";
  if (raw.includes("fieldstaff") || raw.includes("field_staff") || raw.includes("field staff")) return "fieldstaff";
  return "operator";
};

async function resolveAcceptedInviteContext(
  client: NonNullable<ReturnType<typeof getSupabaseAdmin>> | Awaited<ReturnType<typeof supabaseServer>>,
  userId: string,
  email: string
) {
  let pendingInvite = await client
    .from("pending_invitations")
    .select("company_id, employee_id, role, accepted_at")
    .eq("accepted_user_id", userId)
    .not("accepted_at", "is", null)
    .order("accepted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingInvite.error && /accepted_at|accepted_user_id|created_at|Could not find the '.*' column/i.test(pendingInvite.error.message || "")) {
    pendingInvite = await client
      .from("pending_invitations")
      .select("company_id, employee_id, role")
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
      role: normalizeEmployeeRole(pendingInvite.data.role),
    };
  }

  const legacyInvite = await client
    .from("invite_tokens")
    .select("company_id, employee_id, role, used_at")
    .ilike("email", email)
    .not("used_at", "is", null)
    .order("used_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!legacyInvite.error && legacyInvite.data?.company_id) {
    return {
      companyId: String(legacyInvite.data.company_id),
      employeeId: String(legacyInvite.data.employee_id ?? "").trim() || null,
      role: normalizeEmployeeRole(legacyInvite.data.role),
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

  const loadMembership = async () => {
    const preferred = await supabase
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
      return supabase
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
            data: { id?: string | null; company_id?: string | null; role?: string | null; user_id?: string | null } | null;
          }
        = { error: null, data: null };

      if (acceptedInvite?.employeeId) {
        const employeeByAcceptedInvite = await client
          .from("employees")
          .select("id, company_id, role, user_id")
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
          .select("id, company_id, role, user_id, email")
          .ilike("email", email)
          .order("created_at", { ascending: false })
          .limit(20);

        if (employeeRows.error && /created_at/i.test(employeeRows.error.message || "")) {
          employeeRows = await client
            .from("employees")
            .select("id, company_id, role, user_id, email")
            .ilike("email", email)
            .order("id", { ascending: false })
            .limit(20);
        }

        if (!employeeRows.error) {
          const rows = (employeeRows.data ?? []) as Array<{
            id?: string | null;
            company_id?: string | null;
            role?: string | null;
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
          const membershipRole = normalizeMembershipRole(acceptedInvite?.role ?? inviteEmployee.data.role);
          const employeeRole = normalizeEmployeeRole(acceptedInvite?.role ?? inviteEmployee.data.role);

          const existingCompanyMemberships = await listCompanyMembershipRoles(
            client,
            String(inviteEmployee.data.company_id)
          );
          const hasCeoMembership = existingCompanyMemberships.some((row) =>
            isCeoMembershipRole(row.role)
          );
          const safeMembershipRole = hasCeoMembership
            ? membershipRole
            : COMPANY_OWNER_MEMBERSHIP_ROLE;
          const safeEmployeeRole = safeMembershipRole === COMPANY_OWNER_MEMBERSHIP_ROLE ? "admin" : employeeRole;

          const membershipInsert = await client.from("memberships").upsert(
            {
              company_id: inviteEmployee.data.company_id,
              user_id: userData.user.id,
              role: safeMembershipRole,
            },
            { onConflict: "company_id,user_id" }
          );

          if (
            membershipInsert.error &&
            !/duplicate key|unique/i.test(membershipInsert.error.message || "")
          ) {
            throw new TenantResolverError(membershipInsert.error.message || "Failed to create membership", 400);
          }

          const employeeUpdate = await client
            .from("employees")
            .update({ user_id: userData.user.id, role: safeEmployeeRole })
            .eq("id", inviteEmployee.data.id)
            .eq("company_id", inviteEmployee.data.company_id);

          if (
            employeeUpdate.error &&
            /Could not find the 'user_id' column/i.test(employeeUpdate.error.message || "")
          ) {
            await client
              .from("employees")
              .update({ role: safeEmployeeRole })
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
    throw new TenantResolverError("No company membership found (run bootstrap)", 403);
  }

  return { supabase, companyId, userId: userData.user.id, userEmail: String(userData.user.email ?? "").trim().toLowerCase() };
}
