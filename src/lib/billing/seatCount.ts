import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Counts active billable seats for a company.
 *
 * A seat is billable when the employee has:
 *   - Accepted their invite (user_id is set, meaning they have logged in)
 *   - Not been deactivated (status != 'inactive')
 *
 * Pending invites (user_id IS NULL) do NOT count.
 * Inactive/removed employees do NOT count.
 * The CEO/owner counts as seat 1.
 */
export async function getActiveBillableSeatCount(companyId: string): Promise<number> {
  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }

  // Primary: employees with an accepted user_id and not inactive.
  const { count, error } = await admin
    .from("employees")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .not("user_id", "is", null)
    .neq("status", "inactive");

  if (!error && count !== null) {
    // Always at least 1 (the CEO).
    return Math.max(1, count);
  }

  // Fallback: if employees table query failed (e.g. missing columns), count memberships.
  // Every accepted member has a membership row; pending invites don't.
  console.warn("[seatCount] employees query failed, falling back to memberships:", error?.message);
  const memberships = await admin
    .from("memberships")
    .select("user_id", { count: "exact", head: true })
    .eq("company_id", companyId);

  return Math.max(1, memberships.count ?? 1);
}
