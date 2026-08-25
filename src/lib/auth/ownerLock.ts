/* eslint-disable @typescript-eslint/no-explicit-any */
import { getPrimaryOwnerUserId } from "@/lib/auth/companyOwnership";

/**
 * True only when an employee row represents the company's primary owner.
 * Owner-level roles are deliberately ignored: Co-Owners must remain editable.
 */
export async function isCompanyOwnerEmployee(params: {
  adminClient: any | null;
  db: any;
  companyId: string;
  employeeUserId: unknown;
  employeeEmail: unknown;
}): Promise<boolean> {
  const linkedUserId = String(params.employeeUserId ?? "").trim();
  const email = String(params.employeeEmail ?? "").trim().toLowerCase();
  const primaryOwnerUserId = await getPrimaryOwnerUserId({
    db: params.db,
    companyId: params.companyId,
  });

  if (linkedUserId && linkedUserId === primaryOwnerUserId) return true;

  if (email && params.adminClient && primaryOwnerUserId) {
    const { data, error } = await params.adminClient.auth.admin.getUserById(
      primaryOwnerUserId
    );
    if (!error && String(data?.user?.email ?? "").trim().toLowerCase() === email) {
      return true;
    }
  }

  return false;
}
