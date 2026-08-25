import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Counts active billable seats for a company.
 *
 * Source of truth: memberships table (includes CEO/owner who may not have an
 * employees row). Every accepted member has a membership row; pending invites
 * (no user_id yet) don't appear here.
 *
 * Counting model (one company = one Stripe subscription, quantity = this count):
 *   start with the CEO/owner (1) and add each accepted active employee user.
 *
 * Each person is counted exactly ONCE by DISTINCT auth user_id — we never add
 * both a membership row and an employees row for the same person, and duplicate
 * membership rows for one user are collapsed.
 *
 * Excluded:
 *   - pending invites (no membership row / no user_id yet)
 *   - null/empty user_id rows
 *   - deleted / inactive / archived / removed employees
 *   - duplicate membership rows for the same user
 *
 * Always returns at least 1 (a valid company always has its owner).
 */
const INACTIVE_EMPLOYEE_STATUSES = ["inactive", "deleted", "archived", "removed"];
const OWNER_MEMBERSHIP_ROLES = ["admin", "ceo", "executive", "owner", "co_owner"];

export async function getActiveBillableSeatCount(companyId: string): Promise<number> {
  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }

  // ── Active employees (source of truth for staff seats) ─────────────────────
  // We do NOT count memberships alone: when an employee is deleted, the
  // employees row is removed but a membership row can linger, which previously
  // produced phantom seats (the "11th" seat). Staff seats come from the
  // employees table, filtered to active rows with a real user_id.
  const { data: employeeRows, error: employeeError } = await admin
    .from("employees")
    .select("user_id, status")
    .eq("company_id", companyId);

  if (employeeError) {
    console.warn("[seatCount] employees query failed:", employeeError.message);
  }

  const activeEmployeeUserIds = new Set<string>();
  for (const row of employeeRows ?? []) {
    const userId = String(row.user_id ?? "").trim();
    if (!userId) continue; // pending invite / unlinked row
    const status = String(row.status ?? "").trim().toLowerCase();
    if (INACTIVE_EMPLOYEE_STATUSES.includes(status)) continue; // deleted/inactive/archived/removed
    activeEmployeeUserIds.add(userId);
  }

  // ── Owner(s) (CEO) — always billable, identified via admin membership ──────
  // The owner may not have an employees row, so include them from memberships.
  const { data: membershipRows, error: membershipError } = await admin
    .from("memberships")
    .select("user_id, role")
    .eq("company_id", companyId);

  if (membershipError) {
    console.warn("[seatCount] memberships query failed:", membershipError.message);
  }

  const ownerUserIds = new Set<string>();
  const distinctMembershipUserIds = new Set<string>();
  for (const row of membershipRows ?? []) {
    const userId = String(row.user_id ?? "").trim();
    if (!userId) continue;
    distinctMembershipUserIds.add(userId);
    const role = String(row.role ?? "").trim().toLowerCase();
    if (OWNER_MEMBERSHIP_ROLES.includes(role)) ownerUserIds.add(userId);
  }

  // ── Billable seats = DISTINCT( active employees ∪ owners ) ─────────────────
  // Union de-dupes by user_id, so the CEO is counted exactly once even if they
  // also have an employees row, and duplicate rows never double-count.
  const seatUserIds = new Set<string>([...activeEmployeeUserIds, ...ownerUserIds]);
  const seats = Math.max(1, seatUserIds.size);

  console.log("[seatCount]", {
    company_id: companyId,
    employeeRows: (employeeRows ?? []).length,
    activeEmployeeUserIds: activeEmployeeUserIds.size,
    membershipRows: (membershipRows ?? []).length,
    distinctMembershipUserIds: distinctMembershipUserIds.size,
    ownerUserIds: ownerUserIds.size,
    excludedStatuses: INACTIVE_EMPLOYEE_STATUSES,
    seats,
  });

  // Always at least 1 (a valid company always has its owner).
  return seats;
}
