/* eslint-disable @typescript-eslint/no-explicit-any */
import { normalizeAppRole, type AppRole } from "@/lib/nav/config";

const MISSING_SCHEMA_RE = /(column .* does not exist|Could not find the '.*' column|relation .* does not exist|Could not find the table)/i;

function isMissingSchema(message: string | undefined) {
  return MISSING_SCHEMA_RE.test(message ?? "");
}

function normalizeId(value: unknown): string {
  return String(value ?? "");
}

export async function resolveMembershipRole(
  supabase: any,
  companyId: string,
  userId: string
): Promise<AppRole | null> {
  const { data, error } = await supabase
    .from("memberships")
    .select("role")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .limit(1);

  if (error) {
    throw new Error(error.message);
  }

  return normalizeAppRole(data?.[0]?.role);
}

async function resolveCurrentUserEmail(supabase: any) {
  const { data } = await supabase.auth.getUser();
  return data?.user?.email?.toLowerCase() ?? "";
}

async function getEmployeeIdsByColumn(
  supabase: any,
  companyId: string,
  column: string,
  value: string
): Promise<string[]> {
  if (!value) return [];

  const result = await supabase
    .from("employees")
    .select("id")
    .eq("company_id", companyId)
    .eq(column, value);

  if (result.error) {
    if (isMissingSchema(result.error.message)) return [];
    throw new Error(result.error.message);
  }

  return (result.data ?? []).map((row: { id: string }) => String(row.id));
}

export async function getAssignedJobIds(
  supabase: any,
  companyId: string,
  userId: string
): Promise<string[]> {
  const userEmail = await resolveCurrentUserEmail(supabase);
  const employeeIds = new Set<string>();

  for (const id of await getEmployeeIdsByColumn(supabase, companyId, "user_id", userId)) {
    employeeIds.add(id);
  }

  for (const id of await getEmployeeIdsByColumn(supabase, companyId, "email", userEmail)) {
    employeeIds.add(id);
  }

  for (const id of await getEmployeeIdsByColumn(supabase, companyId, "id", userId)) {
    employeeIds.add(id);
  }

  if (employeeIds.size === 0) return [];

  const { data, error } = await supabase
    .from("job_employees")
    .select("job_id")
    .eq("company_id", companyId)
    .in("employee_id", Array.from(employeeIds));

  if (error) {
    if (isMissingSchema(error.message)) return [];
    throw new Error(error.message);
  }

  return Array.from(new Set((data ?? []).map((row: { job_id: string | number }) => normalizeId(row.job_id))));
}

export async function getRoleScopedJobIds(
  supabase: any,
  companyId: string,
  userId: string,
  role: AppRole
): Promise<string[] | null> {
  if (role === "admin" || role === "pm") return null;
  return getAssignedJobIds(supabase, companyId, userId);
}

export async function getRoleScopedEquipmentIds(
  supabase: any,
  companyId: string,
  userId: string,
  role: AppRole
): Promise<string[] | null> {
  if (role === "admin" || role === "pm" || role === "mechanic") return null;

  const scopedJobIds = await getAssignedJobIds(supabase, companyId, userId);
  if (scopedJobIds.length === 0) return [];

  const equipmentIds = new Set<string>();

  const fromJoin = await supabase
    .from("job_equipment")
    .select("equipment_id")
    .eq("company_id", companyId)
    .in("job_id", scopedJobIds);

  if (fromJoin.error) {
    if (!isMissingSchema(fromJoin.error.message)) {
      throw new Error(fromJoin.error.message);
    }
  } else {
    for (const row of fromJoin.data ?? []) {
      equipmentIds.add(normalizeId((row as { equipment_id: unknown }).equipment_id));
    }
  }

  const fromEquipmentJobId = await supabase
    .from("equipment")
    .select("id")
    .eq("company_id", companyId)
    .in("job_id", scopedJobIds);

  if (fromEquipmentJobId.error) {
    if (!isMissingSchema(fromEquipmentJobId.error.message)) {
      throw new Error(fromEquipmentJobId.error.message);
    }
  } else {
    for (const row of fromEquipmentJobId.data ?? []) {
      equipmentIds.add(normalizeId((row as { id: unknown }).id));
    }
  }

  return Array.from(equipmentIds);
}
