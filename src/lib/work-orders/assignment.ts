/* eslint-disable @typescript-eslint/no-explicit-any */
import { normalizeAppRole } from "@/lib/nav/config";
import { isMissingLegacyPermissionProfileColumn } from "@/lib/auth/teamRoles";

export type WorkOrderAssignmentMode = "in_house" | "outsourced";

type ResolveParams = {
  supabase: any;
  companyId: string;
  assignedTo: unknown;
  assignmentMode: unknown;
};

type ResolveResult =
  | { ok: true; assignedTo: string | null; assignmentMode: WorkOrderAssignmentMode }
  | { ok: false; error: string; status?: number };

const INACTIVE_EMPLOYEE_STATUSES = new Set(["inactive", "deleted", "archived"]);

function normalizeUuid(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidPattern.test(trimmed) ? trimmed : null;
}

function normalizeAssignmentMode(value: unknown): WorkOrderAssignmentMode {
  return String(value ?? "").trim().toLowerCase() === "outsourced" ? "outsourced" : "in_house";
}

export async function resolveWorkOrderAssignment({
  supabase,
  companyId,
  assignedTo,
  assignmentMode,
}: ResolveParams): Promise<ResolveResult> {
  const normalizedMode = normalizeAssignmentMode(assignmentMode);
  if (normalizedMode === "outsourced") {
    return {
      ok: true,
      assignedTo: null,
      assignmentMode: "outsourced",
    };
  }

  const normalizedAssignedTo = normalizeUuid(assignedTo);
  if (!normalizedAssignedTo) {
    return {
      ok: true,
      assignedTo: null,
      assignmentMode: "in_house",
    };
  }

  let membership = await supabase
    .from("memberships")
    .select("user_id, role, legacy_permission_profile")
    .eq("company_id", companyId)
    .eq("user_id", normalizedAssignedTo)
    .maybeSingle();

  if (isMissingLegacyPermissionProfileColumn(membership.error)) {
    const legacyMembership = await supabase
      .from("memberships")
      .select("user_id, role")
      .eq("company_id", companyId)
      .eq("user_id", normalizedAssignedTo)
      .maybeSingle();
    membership = {
      ...legacyMembership,
      data: legacyMembership.data
        ? { ...legacyMembership.data, legacy_permission_profile: null }
        : null,
    } as typeof membership;
  }

  if (membership.error) {
    return { ok: false, error: membership.error.message || "Failed to validate assigned technician." };
  }

  const role = normalizeAppRole(
    membership.data?.role,
    membership.data?.legacy_permission_profile
  );
  if (!membership.data || role !== "mechanic") {
    return { ok: false, status: 422, error: "Assigned technician must be an active Team Member with maintenance access." };
  }

  const employee = await supabase
    .from("employees")
    .select("status")
    .eq("company_id", companyId)
    .eq("user_id", normalizedAssignedTo)
    .maybeSingle();

  if (employee.error && !/column employees\.(status|user_id) does not exist|Could not find the '(status|user_id)' column/i.test(employee.error.message || "")) {
    return { ok: false, error: employee.error.message || "Failed to validate assigned technician." };
  }

  if (employee.data) {
    const status = String(employee.data.status ?? "").trim().toLowerCase();
    if (status && INACTIVE_EMPLOYEE_STATUSES.has(status)) {
      return { ok: false, status: 422, error: "Assigned technician must be active." };
    }
  }

  return {
    ok: true,
    assignedTo: normalizedAssignedTo,
    assignmentMode: "in_house",
  };
}
