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

export async function getActiveBillableSeatCount(companyId: string): Promise<number> {
  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }

  // 1. Fetch all accepted members. memberships always have a user_id; the CEO
  //    and every accepted employee each have exactly one logical membership.
  const { data: membershipRows, error: membershipError } = await admin
    .from("memberships")
    .select("user_id")
    .eq("company_id", companyId);

  if (membershipError) {
    console.warn("[seatCount] memberships query failed:", membershipError.message);
    return 1;
  }

  // 2. Collapse to DISTINCT non-null user IDs (defends against duplicate
  //    membership rows so nobody is double-counted).
  const distinctUserIds = Array.from(
    new Set(
      (membershipRows ?? [])
        .map((r) => String(r.user_id ?? "").trim())
        .filter(Boolean)
    )
  );

  if (distinctUserIds.length === 0) {
    // Company exists but has no membership rows yet — owner still counts.
    return 1;
  }

  // 3. Exclude users whose employees record is deactivated/deleted/archived.
  const { data: inactiveRows } = await admin
    .from("employees")
    .select("user_id")
    .eq("company_id", companyId)
    .in("user_id", distinctUserIds)
    .in("status", INACTIVE_EMPLOYEE_STATUSES);

  const inactiveIds = new Set(
    (inactiveRows ?? []).map((r) => String(r.user_id ?? "").trim()).filter(Boolean)
  );

  const activeCount = distinctUserIds.filter((id) => !inactiveIds.has(id)).length;
  const seats = Math.max(1, activeCount);

  console.log(
    `[seatCount] company=${companyId} membershipRows=${(membershipRows ?? []).length} ` +
      `distinctUsers=${distinctUserIds.length} inactive=${inactiveIds.size} seats=${seats}`
  );

  // Always at least 1 (the CEO/owner).
  return seats;
}
