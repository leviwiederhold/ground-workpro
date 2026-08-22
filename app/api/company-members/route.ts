import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { forbidden, notFound, serverError } from "@/lib/http/errors";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const USER_ID_BATCH_SIZE = 100;

function batchUserIds(userIds: string[]) {
  const batches: string[][] = [];
  for (let index = 0; index < userIds.length; index += USER_ID_BATCH_SIZE) {
    batches.push(userIds.slice(index, index + USER_ID_BATCH_SIZE));
  }
  return batches;
}

function toRoleLabel(role: unknown) {
  const normalized = String(role ?? "").trim().toLowerCase();
  if (normalized === "ceo") return "CEO";
  if (normalized === "admin") return "CEO";
  if (normalized === "pm") return "Operations Manager";
  if (normalized === "foreman") return "Foreman";
  if (normalized === "mechanic") return "Mechanic";
  if (normalized === "fieldstaff" || normalized === "field_staff" || normalized === "field staff") return "Field Staff";
  if (normalized === "operator") return "Operator";
  return normalized || "Member";
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

export async function GET(request: Request) {
  try {
    const { supabase, companyId, userId } = await getCompanyId();
    const admin = getSupabaseAdmin();
    const db = admin ?? supabase;
    const url = new URL(request.url);
    const excludeSelf = url.searchParams.get("excludeSelf") !== "0";

    let memberships = excludeSelf
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

    if (memberships.error && /created_at|Could not find the 'created_at' column/i.test(memberships.error.message || "")) {
      memberships = excludeSelf
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

    if (memberships.error) return serverError();

    const membershipRows = memberships.data ?? [];
    const userIds = Array.from(
      new Set(
        membershipRows
          .map((row) => String(row.user_id ?? "").trim())
          .filter(Boolean)
      )
    );

    const profiles: {
      data: Array<{ id?: string; full_name?: string; display_name?: string; avatar_url?: string }> | null;
      error: { message?: string } | null;
    } = { data: [], error: null };

    for (const userIdBatch of batchUserIds(userIds)) {
      let profileBatch: {
        data: Array<{ id?: string; full_name?: string; display_name?: string; avatar_url?: string }> | null;
        error: { message?: string } | null;
      } = await db
        .from("profiles")
        .select("id, full_name, display_name, avatar_url")
        .in("id", userIdBatch);

      if (profileBatch.error && /display_name|Could not find the 'display_name' column/i.test(profileBatch.error.message || "")) {
        profileBatch = await db
          .from("profiles")
          .select("id, full_name, avatar_url")
          .in("id", userIdBatch);
      }
      if (profileBatch.error && /avatar_url|Could not find the 'avatar_url' column/i.test(profileBatch.error.message || "")) {
        profileBatch = await db
          .from("profiles")
          .select("id, full_name")
          .in("id", userIdBatch);
      }
      if (profileBatch.error) {
        profiles.error = profileBatch.error;
        break;
      }
      profiles.data?.push(...(profileBatch.data ?? []));
    }

    if (profiles.error) return serverError();

    const employees: {
      data: Array<{ user_id: string; name?: string; full_name?: string; email?: string; role?: string | null; status?: string | null }> | null;
      error: { message?: string } | null;
    } = { data: [], error: null };
    for (const userIdBatch of batchUserIds(userIds)) {
      let employeeBatch: {
        data: Array<{ user_id: string; name?: string; full_name?: string; email?: string; role?: string | null; status?: string | null }> | null;
        error: { message?: string } | null;
      } = await db
          .from("employees")
          .select("user_id, name, full_name, email, role, status")
          .eq("company_id", companyId)
          .in("user_id", userIdBatch);
      if (employeeBatch.error && /column employees\.name does not exist|Could not find the 'name' column/i.test(employeeBatch.error.message || "")) {
        employeeBatch = await db
          .from("employees")
          .select("user_id, full_name, email, role, status")
          .eq("company_id", companyId)
          .in("user_id", userIdBatch);
      }
      if (employeeBatch.error) {
        employees.error = employeeBatch.error;
        break;
      }
      employees.data?.push(...(employeeBatch.data ?? []));
    }
    const employeeRows = employees.error ? [] : employees.data ?? [];
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
    for (const profile of profiles.data ?? []) {
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
      const acceptedInvitesResult = await db
        .from("pending_invitations")
        .select("accepted_user_id, role")
        .eq("company_id", companyId)
        .not("accepted_at", "is", null)
        .in("accepted_user_id", userIds);
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
        return {
          userId: memberUserId,
          role,
          roleLabel: toRoleLabel(role),
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
