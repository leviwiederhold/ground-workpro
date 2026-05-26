import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Counts active billable seats for a company.
 *
 * Source of truth: memberships table (includes CEO/owner who may not have an
 * employees row). Every accepted member has a membership row; pending invites
 * (no user_id yet) don't appear here.
 *
 * Rules:
 *   - Membership rows are the accepted members (user_id is always set).
 *   - Members whose employees row has status = 'inactive' | 'deleted' | 'archived'
 *     are excluded as deactivated.
 *   - Pending invites do NOT count (they have no membership row yet).
 *   - Always returns at least 1 for an active/trialing company with a valid owner.
 */
export async function getActiveBillableSeatCount(companyId: string): Promise<number> {
  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }

  // 1. Fetch all accepted members (memberships always have a user_id).
  const { data: membershipRows, error: membershipError } = await admin
    .from("memberships")
    .select("user_id")
    .eq("company_id", companyId);

  if (membershipError) {
    console.warn("[seatCount] memberships query failed:", membershipError.message);
    return 1;
  }

  const userIds = (membershipRows ?? [])
    .map((r) => String(r.user_id ?? "").trim())
    .filter(Boolean);

  if (userIds.length === 0) {
    // Company exists but has no membership rows yet — owner still counts.
    return 1;
  }

  // 2. Find which of those users are deactivated in the employees table.
  const { data: inactiveRows } = await admin
    .from("employees")
    .select("user_id")
    .eq("company_id", companyId)
    .in("user_id", userIds)
    .in("status", ["inactive", "deleted", "archived"]);

  const inactiveIds = new Set(
    (inactiveRows ?? []).map((r) => String(r.user_id ?? "").trim()).filter(Boolean)
  );

  const activeCount = userIds.filter((id) => !inactiveIds.has(id)).length;

  // Always at least 1 (the CEO/owner).
  return Math.max(1, activeCount);
}
