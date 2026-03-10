import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireModuleAccess } from "@/lib/auth/requireRole";
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

export async function GET() {
  try {
    try {
      await requireModuleAccess("messages", "view");
    } catch {
      return forbidden();
    }

    const { supabase, companyId, userId } = await getCompanyId();
    const admin = getSupabaseAdmin();
    const db = admin ?? supabase;

    let memberships = await db
      .from("memberships")
      .select("user_id, role")
      .eq("company_id", companyId)
      .neq("user_id", userId)
      .order("created_at", { ascending: true });

    if (memberships.error && /created_at|Could not find the 'created_at' column/i.test(memberships.error.message || "")) {
      memberships = await db
        .from("memberships")
        .select("user_id, role")
        .eq("company_id", companyId)
        .neq("user_id", userId)
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

    let profiles: { data: Array<{ id?: string; full_name?: string; display_name?: string; email?: string }> | null; error: { message?: string } | null } = userIds.length
      ? await db.from("profiles").select("id, full_name, display_name, email").in("id", userIds)
      : { data: [], error: null };

    if (profiles.error && /display_name|Could not find the 'display_name' column/i.test(profiles.error.message || "")) {
      const fallbackProfiles = userIds.length
        ? await db.from("profiles").select("id, full_name, email").in("id", userIds)
        : { data: [], error: null };
      profiles = {
        data: (fallbackProfiles.data ?? []).map((row: { id?: string; full_name?: string; email?: string }) => ({
          id: row.id,
          full_name: row.full_name,
          email: row.email,
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
    // Employees lookup is best-effort; if it fails, fall back to profiles-only names.
    const employeeRows = employees.error ? [] : employees.data ?? [];

    const nameById = new Map<string, string>();
    for (const profile of profiles.data ?? []) {
      nameById.set(
        String(profile.id),
        pickDisplayName({
          fullName: profile.full_name,
          displayName: profile.display_name,
          email: profile.email,
        })
      );
    }
    for (const employee of employeeRows) {
      const userIdKey = String(employee.user_id ?? "").trim();
      if (!userIdKey || nameById.has(userIdKey)) continue;
      const employeeName = pickDisplayName({
        fullName: employee.full_name ?? employee.name,
        displayName: employee.name,
        email: employee.email,
      });
      if (employeeName) {
        nameById.set(userIdKey, employeeName);
      }
    }

    if (admin) {
      const missingUserIds = userIds.filter((id) => !nameById.has(id));
      if (missingUserIds.length > 0) {
        const listUsersResult = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        if (!listUsersResult.error) {
          const emailById = new Map(
            (listUsersResult.data.users ?? []).map((user) => [String(user.id), String(user.email ?? "").trim()])
          );
          for (const missingUserId of missingUserIds) {
            const email = emailById.get(missingUserId);
            if (email) nameById.set(missingUserId, email);
          }
        }
      }
    }

    return Response.json({
      items: (memberships.data ?? []).map((row) => ({
        userId: row.user_id,
        role: toRoleLabel(row.role),
        displayName: nameById.get(String(row.user_id ?? "").trim()) || "Team Member",
      })),
    });
  } catch (error) {
    if (error instanceof TenantResolverError) return tenantError(error);
    return serverError();
  }
}
