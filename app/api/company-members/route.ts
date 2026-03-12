import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { forbidden, notFound, serverError } from "@/lib/http/errors";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

function toRoleLabel(role: unknown) {
  const normalized = String(role ?? "").trim().toLowerCase();
  if (normalized === "ceo") return "CEO";
  if (normalized === "admin") return "CEO";
  if (normalized === "pm") return "Operations Manager";
  if (normalized === "foreman") return "Foreman";
  if (normalized === "mechanic") return "Mechanic";
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

    const userIds = Array.from(
      new Set(
        (memberships.data ?? [])
          .map((row) => String(row.user_id ?? "").trim())
          .filter(Boolean)
      )
    );

    let profiles: {
      data: Array<{ id?: string; full_name?: string; display_name?: string; email?: string; avatar_url?: string }> | null;
      error: { message?: string } | null;
    } = userIds.length
      ? await db.from("profiles").select("id, full_name, display_name, email, avatar_url").in("id", userIds)
      : { data: [], error: null };

    if (profiles.error && /avatar_url|Could not find the 'avatar_url' column/i.test(profiles.error.message || "")) {
      const fallbackProfiles = userIds.length
        ? await db.from("profiles").select("id, full_name, display_name, email").in("id", userIds)
        : { data: [], error: null };
      profiles = {
        data: (fallbackProfiles.data ?? []).map(
          (row: { id?: string; full_name?: string; display_name?: string; email?: string }) => ({
            id: row.id,
            full_name: row.full_name,
            display_name: row.display_name,
            email: row.email,
          })
        ),
        error: fallbackProfiles.error,
      };
    }

    if (profiles.error && /email|Could not find the 'email' column/i.test(profiles.error.message || "")) {
      const fallbackProfiles = userIds.length
        ? await db.from("profiles").select("id, full_name, display_name, avatar_url").in("id", userIds)
        : { data: [], error: null };
      profiles = {
        data: (fallbackProfiles.data ?? []).map(
          (row: { id?: string; full_name?: string; display_name?: string; avatar_url?: string }) => ({
            id: row.id,
            full_name: row.full_name,
            display_name: row.display_name,
            avatar_url: row.avatar_url,
          })
        ),
        error: fallbackProfiles.error,
      };
    }

    if (profiles.error && /display_name|Could not find the 'display_name' column/i.test(profiles.error.message || "")) {
      const fallbackProfiles = userIds.length
        ? await db.from("profiles").select("id, full_name").in("id", userIds)
        : { data: [], error: null };
      profiles = {
        data: (fallbackProfiles.data ?? []).map((row: { id?: string; full_name?: string }) => ({
          id: row.id,
          full_name: row.full_name,
        })),
        error: fallbackProfiles.error,
      };
    }

    if (profiles.error) return serverError();

    let employees: { data: Array<{ user_id: string; name?: string; full_name?: string; email?: string }> | null; error: { message?: string } | null } = userIds.length
      ? await db
          .from("employees")
          .select("user_id, name, full_name, email")
          .eq("company_id", companyId)
          .in("user_id", userIds)
      : { data: [], error: null };
    if (employees.error && /column employees\.name does not exist|Could not find the 'name' column/i.test(employees.error.message || "")) {
      employees = await db
        .from("employees")
        .select("user_id, full_name")
        .eq("company_id", companyId)
        .in("user_id", userIds);
    }
    const employeeRows = employees.error ? [] : employees.data ?? [];

    const nameById = new Map<string, string>();
    const emailById = new Map<string, string>();
    const avatarById = new Map<string, string>();
    for (const profile of profiles.data ?? []) {
      const key = String(profile.id ?? "").trim();
      if (!key) continue;
      nameById.set(
        key,
        pickDisplayName({
          fullName: profile.full_name,
          displayName: profile.display_name,
          email: profile.email,
        })
      );
      const email = String(profile.email ?? "").trim();
      if (email) emailById.set(key, email);
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
      items: (memberships.data ?? []).map((row) => {
        const memberUserId = String(row.user_id ?? "").trim();
        const role = String(row.role ?? "").trim().toLowerCase();
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
