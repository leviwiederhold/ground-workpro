import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { forbidden, notFound, serverError } from "@/lib/http/errors";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  canonicalTeamRoleLabel,
  isMissingLegacyPermissionProfileColumn,
} from "@/lib/auth/teamRoles";
import {
  getPrimaryOwnerUserId,
  resolveCompanyTeamRole,
} from "@/lib/auth/companyOwnership";

function toRoleLabel(role: unknown) {
  return canonicalTeamRoleLabel(role);
}

function tenantError(error: TenantResolverError) {
  if (error.status === 404) return notFound(error.message);
  if (error.status === 403) return forbidden(error.message);
  return serverError(error.message);
}

const pickDisplayName = ({
  fullName,
  displayName,
  email,
}: {
  fullName?: unknown;
  displayName?: unknown;
  email?: unknown;
}) => {
  const normalizedFullName = String(fullName ?? "").trim();
  if (normalizedFullName) return normalizedFullName;
  const normalizedDisplayName = String(displayName ?? "").trim();
  if (normalizedDisplayName) return normalizedDisplayName;
  const normalizedEmail = String(email ?? "").trim();
  if (normalizedEmail) return normalizedEmail;
  return "Team Member";
};

const chunkValues = <T,>(values: T[], size = 100): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
};

export async function GET(request: Request) {
  try {
    const { supabase, companyId, userId } = await getCompanyId();
    const admin = getSupabaseAdmin();
    const db = admin ?? supabase;
    const primaryOwnerUserId = await getPrimaryOwnerUserId({ db, companyId });
    const url = new URL(request.url);
    const excludeSelf = url.searchParams.get("excludeSelf") !== "0";

    const preferredMemberships = excludeSelf
      ? await db
          .from("memberships")
          .select("user_id, role, legacy_permission_profile")
          .eq("company_id", companyId)
          .neq("user_id", userId)
          .order("created_at", { ascending: true })
      : await db
          .from("memberships")
          .select("user_id, role, legacy_permission_profile")
          .eq("company_id", companyId)
          .order("created_at", { ascending: true });
    let membershipRows: Array<{
      user_id?: string | null;
      role?: string | null;
      legacy_permission_profile?: string | null;
    }> = [];
    let membershipError = preferredMemberships.error;

    if (isMissingLegacyPermissionProfileColumn(membershipError)) {
      let legacyMemberships = excludeSelf
        ? await db
            .from("memberships")
            .select("user_id, role")
            .eq("company_id", companyId)
            .neq("user_id", userId)
            .order("created_at", { ascending: true })
        : await db
            .from("memberships")
            .select("user_id, role")
            .eq("company_id", companyId)
            .order("created_at", { ascending: true });
      if (legacyMemberships.error && /created_at|Could not find the 'created_at' column/i.test(legacyMemberships.error.message || "")) {
        legacyMemberships = excludeSelf
          ? await db
              .from("memberships")
              .select("user_id, role")
              .eq("company_id", companyId)
              .neq("user_id", userId)
              .order("user_id", { ascending: true })
          : await db
              .from("memberships")
              .select("user_id, role")
              .eq("company_id", companyId)
              .order("user_id", { ascending: true });
      }
      membershipRows = (legacyMemberships.data ?? []).map((row) => ({
        ...row,
        legacy_permission_profile: null,
      }));
      membershipError = legacyMemberships.error;
    } else if (membershipError && /created_at|Could not find the 'created_at' column/i.test(membershipError.message || "")) {
      const fallbackMemberships = excludeSelf
        ? await db
            .from("memberships")
            .select("user_id, role, legacy_permission_profile")
            .eq("company_id", companyId)
            .neq("user_id", userId)
            .order("user_id", { ascending: true })
        : await db
            .from("memberships")
            .select("user_id, role, legacy_permission_profile")
            .eq("company_id", companyId)
            .order("user_id", { ascending: true });
      membershipRows = fallbackMemberships.data ?? [];
      membershipError = fallbackMemberships.error;
    } else {
      membershipRows = preferredMemberships.data ?? [];
    }

    if (membershipError) return serverError();
    const userIds = Array.from(
      new Set(
        membershipRows
          .map((row) => String(row.user_id ?? "").trim())
          .filter(Boolean)
      )
    );

    type ProfileRow = { id?: string; full_name?: string; display_name?: string; avatar_url?: string };
    const profileRows: ProfileRow[] = [];
    for (const userIdChunk of chunkValues(userIds)) {
      const preferredProfiles = await db
        .from("profiles")
        .select("id, full_name, display_name, avatar_url")
        .in("id", userIdChunk);
      let chunkProfileRows = (preferredProfiles.data ?? []) as ProfileRow[];
      let profilesError = preferredProfiles.error;
      if (profilesError && /display_name|Could not find the 'display_name' column/i.test(profilesError.message || "")) {
        const fallbackProfiles = await db
          .from("profiles")
          .select("id, full_name, avatar_url")
          .in("id", userIdChunk);
        chunkProfileRows = (fallbackProfiles.data ?? []).map((row) => ({
          ...row,
          display_name: undefined,
        }));
        profilesError = fallbackProfiles.error;
      }
      if (profilesError && /avatar_url|Could not find the 'avatar_url' column/i.test(profilesError.message || "")) {
        const fallbackProfiles = await db
          .from("profiles")
          .select("id, full_name, display_name")
          .in("id", userIdChunk);
        chunkProfileRows = (fallbackProfiles.data ?? []).map((row) => ({
          ...row,
          avatar_url: undefined,
        }));
        profilesError = fallbackProfiles.error;
      }
      if (profilesError) return serverError();
      profileRows.push(...chunkProfileRows);
    }

    type EmployeeRow = {
      user_id: string;
      name?: string;
      full_name?: string;
      email?: string;
      role?: string | null;
      status?: string | null;
    };
    const employeeRows: EmployeeRow[] = [];
    for (const userIdChunk of chunkValues(userIds)) {
      const preferredEmployees = await db
        .from("employees")
        .select("user_id, name, full_name, email, role, status")
        .eq("company_id", companyId)
        .in("user_id", userIdChunk);
      let chunkEmployeeRows = (preferredEmployees.data ?? []) as EmployeeRow[];
      let employeesError = preferredEmployees.error;
      if (employeesError && /column employees\.name does not exist|Could not find the 'name' column/i.test(employeesError.message || "")) {
        const fallbackEmployees = await db
          .from("employees")
          .select("user_id, full_name, status")
          .eq("company_id", companyId)
          .in("user_id", userIdChunk);
        chunkEmployeeRows = (fallbackEmployees.data ?? []).map((row) => ({
          ...row,
          name: undefined,
          email: undefined,
          role: undefined,
        })) as EmployeeRow[];
        employeesError = fallbackEmployees.error;
      }
      if (!employeesError) employeeRows.push(...chunkEmployeeRows);
    }
    const inactiveUserIds = new Set(
      employeeRows
        .filter((row) => ["inactive", "deleted", "archived"].includes(String(row.status ?? "").trim().toLowerCase()))
        .map((row) => String(row.user_id ?? "").trim())
        .filter(Boolean)
    );

    const nameById = new Map<string, string>();
    const emailById = new Map<string, string>();
    const avatarById = new Map<string, string>();
    const roleOverrideById = new Map<string, string>();
    for (const profile of profileRows) {
      const key = String(profile.id ?? "").trim();
      if (!key) continue;
      const profileName = pickDisplayName({
        fullName: profile.full_name,
        displayName: profile.display_name,
      });
      if (profileName !== "Team Member") {
        nameById.set(key, profileName);
      }
      const avatarUrl = String(profile.avatar_url ?? "").trim();
      if (avatarUrl) avatarById.set(key, avatarUrl);
    }
    for (const employee of employeeRows) {
      const userIdKey = String(employee.user_id ?? "").trim();
      if (!userIdKey) continue;
      if (!nameById.has(userIdKey)) {
        const employeeName = pickDisplayName({
          fullName: employee.full_name ?? employee.name,
          displayName: employee.name,
          email: employee.email,
        });
        if (employeeName) nameById.set(userIdKey, employeeName);
      }
      const email = String(employee.email ?? "").trim();
      if (email && !emailById.has(userIdKey)) emailById.set(userIdKey, email);
      const employeeRole = String(employee.role ?? "").trim().toLowerCase();
      if (employeeRole.includes("fieldstaff") || employeeRole.includes("field_staff") || employeeRole.includes("field staff")) {
        roleOverrideById.set(userIdKey, "fieldstaff");
      }
    }

    if (userIds.length > 0) {
      for (const userIdChunk of chunkValues(userIds)) {
        const acceptedInvitesResult = await db
        .from("pending_invitations")
        .select("accepted_user_id, role")
        .eq("company_id", companyId)
        .not("accepted_at", "is", null)
        .in("accepted_user_id", userIdChunk);
        if (!acceptedInvitesResult.error) {
          for (const row of acceptedInvitesResult.data ?? []) {
            const acceptedUserId = String(row.accepted_user_id ?? "").trim();
            const inviteRole = String(row.role ?? "").trim().toLowerCase();
            if (!acceptedUserId) continue;
            if (inviteRole.includes("fieldstaff") || inviteRole.includes("field_staff") || inviteRole.includes("field staff")) {
              roleOverrideById.set(acceptedUserId, "fieldstaff");
            }
          }
        }
      }
    }

    if (admin) {
      const missingUserIds = userIds.filter((id) => !emailById.has(id));
      if (missingUserIds.length > 0) {
        const listUsersResult = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        if (!listUsersResult.error) {
          const emailByAuthUserId = new Map(
            (listUsersResult.data.users ?? []).map((user) => [String(user.id), String(user.email ?? "").trim()])
          );
          for (const missingUserId of missingUserIds) {
            const email = emailByAuthUserId.get(missingUserId);
            if (email) {
              emailById.set(missingUserId, email);
              if (!nameById.has(missingUserId)) nameById.set(missingUserId, email);
            }
          }
        }
      }
    }

    return Response.json({
      items: membershipRows
        .filter((row) => !inactiveUserIds.has(String(row.user_id ?? "").trim()))
        .map((row) => {
        const memberUserId = String(row.user_id ?? "").trim();
        const role = roleOverrideById.get(memberUserId) || String(row.role ?? "").trim().toLowerCase();
        const companyRole = resolveCompanyTeamRole({
          storedRole: role,
          userId: memberUserId,
          primaryOwnerUserId,
        });
        return {
          userId: memberUserId,
          role: companyRole,
          roleLabel: toRoleLabel(companyRole),
          accessProfile: String(row.legacy_permission_profile ?? ""),
          displayName: nameById.get(memberUserId) || emailById.get(memberUserId) || "Team Member",
          email: emailById.get(memberUserId) || "",
          avatarUrl: avatarById.get(memberUserId) || "",
          status: "active",
        };
      }),
    });
  } catch (error) {
    if (error instanceof TenantResolverError) return tenantError(error);
    return serverError();
  }
}
