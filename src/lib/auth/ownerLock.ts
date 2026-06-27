/* eslint-disable @typescript-eslint/no-explicit-any */
import { normalizeAppRole } from "@/lib/nav/config";

/**
 * True when an employee row represents the company owner/CEO.
 *
 * The owner must be detected robustly because the employees row may be unlinked
 * (user_id null) or its role column may have drifted. We therefore match by:
 *   1. employee.role column normalizing to admin, OR
 *   2. the linked membership user_id being an admin member, OR
 *   3. the employee email matching an admin member's auth email.
 *
 * Used to lock the owner's role across the Employees and Team endpoints.
 */
export async function isCompanyOwnerEmployee(params: {
  adminClient: any | null;
  db: any;
  companyId: string;
  employeeRole: unknown;
  employeeUserId: unknown;
  employeeEmail: unknown;
}): Promise<boolean> {
  if (normalizeAppRole(String(params.employeeRole ?? "")) === "admin") return true;

  const linkedUserId = String(params.employeeUserId ?? "").trim();
  const email = String(params.employeeEmail ?? "").trim().toLowerCase();

  const membershipsRes = await params.db
    .from("memberships")
    .select("user_id, role")
    .eq("company_id", params.companyId);
  const adminUserIds: string[] = (membershipsRes.data ?? [])
    .filter((row: any) => normalizeAppRole(String(row.role ?? "")) === "admin")
    .map((row: any) => String(row.user_id ?? "").trim())
    .filter(Boolean);

  if (linkedUserId && adminUserIds.includes(linkedUserId)) return true;

  if (email && params.adminClient && adminUserIds.length > 0) {
    for (const uid of adminUserIds) {
      const { data, error } = await params.adminClient.auth.admin.getUserById(uid);
      if (!error && String(data?.user?.email ?? "").trim().toLowerCase() === email) {
        return true;
      }
    }
  }

  return false;
}
