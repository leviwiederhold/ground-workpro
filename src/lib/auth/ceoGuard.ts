import type { getCompanyId } from "@/lib/tenant/getCompanyId";
import { isOwnerLevelTeamRole } from "./teamRoles.ts";

export type MembershipRole = "ceo" | "admin" | "pm" | "foreman" | "mechanic" | "operator";
type SupabaseClientLike = Awaited<ReturnType<typeof getCompanyId>>["supabase"];

export function isCeoMembershipRole(value: unknown): boolean {
  return isOwnerLevelTeamRole(value);
}

export async function listCompanyMembershipRoles(
  supabase: SupabaseClientLike,
  companyId: string
): Promise<Array<{ user_id: string; role: string }>> {
  const result = await supabase
    .from("memberships")
    .select("user_id, role")
    .eq("company_id", companyId);
  if (result.error) {
    throw new Error(result.error.message);
  }
  return (result.data ?? []).map((row: { user_id?: string; role?: string }) => ({
    user_id: String(row.user_id ?? ""),
    role: String(row.role ?? ""),
  }));
}

export async function ensureCompanyHasAtLeastOneCeoMembership(
  supabase: SupabaseClientLike,
  companyId: string
) {
  const roles = await listCompanyMembershipRoles(supabase, companyId);
  const hasCeo = roles.some((row) => isCeoMembershipRole(row.role));
  if (!hasCeo) {
    throw new Error("Company must always have at least one Owner membership");
  }
}
