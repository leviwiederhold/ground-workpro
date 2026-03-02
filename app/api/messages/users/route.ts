import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { forbidden, notFound, serverError } from "@/lib/http/errors";

function toRoleLabel(role: unknown) {
  const normalized = String(role ?? "").trim().toLowerCase();
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

export async function GET() {
  try {
    const { supabase, companyId, userId } = await getCompanyId();

    const memberships = await supabase
      .from("memberships")
      .select("user_id, role")
      .eq("company_id", companyId)
      .neq("user_id", userId)
      .order("created_at", { ascending: true });

    if (memberships.error) return serverError();

    const userIds = (memberships.data ?? []).map((row) => String(row.user_id));
    const profiles = userIds.length
      ? await supabase.from("profiles").select("id, full_name").in("id", userIds)
      : { data: [], error: null };

    if (profiles.error) return serverError();

    let employees: { data: Array<{ user_id: string; name?: string; full_name?: string }> | null; error: { message?: string } | null } = userIds.length
      ? await supabase
          .from("employees")
          .select("user_id, name, full_name")
          .eq("company_id", companyId)
          .in("user_id", userIds)
      : { data: [], error: null };
    if (employees.error && /column employees\.name does not exist|Could not find the 'name' column/i.test(employees.error.message || "")) {
      employees = await supabase
        .from("employees")
        .select("user_id, full_name")
        .eq("company_id", companyId)
        .in("user_id", userIds);
    }
    // Employees lookup is best-effort; if it fails, fall back to profiles-only names.
    const employeeRows = employees.error ? [] : employees.data ?? [];

    const nameById = new Map((profiles.data ?? []).map((profile) => [String(profile.id), String(profile.full_name ?? "")])) as Map<string, string>;
    for (const employee of employeeRows) {
      const employeeName = String(employee.name ?? employee.full_name ?? "").trim();
      if (employeeName) {
        nameById.set(String(employee.user_id), employeeName);
      }
    }

    return Response.json({
      items: (memberships.data ?? []).map((row) => ({
        userId: row.user_id,
        role: toRoleLabel(row.role),
        displayName: nameById.get(String(row.user_id)) || "Team Member",
      })),
    });
  } catch (error) {
    if (error instanceof TenantResolverError) return tenantError(error);
    return serverError();
  }
}
