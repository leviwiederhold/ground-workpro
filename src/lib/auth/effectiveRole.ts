import { cookies } from "next/headers";
import { getCompanyId } from "@/lib/tenant/getCompanyId";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { normalizeAppRole, type AppRole } from "@/lib/nav/config";

export const ACTING_ROLE_COOKIE = "gw_acting_role";

const ROLE_RANK: Record<AppRole, number> = {
  admin: 5,
  pm: 4,
  foreman: 3,
  mechanic: 2,
  operator: 1,
};

export function clampActingRole(realRole: AppRole, requestedRole: AppRole): AppRole {
  return ROLE_RANK[requestedRole] <= ROLE_RANK[realRole] ? requestedRole : realRole;
}

export async function resolveRealRole(
  supabase: Awaited<ReturnType<typeof getCompanyId>>["supabase"],
  companyId: string,
  userId: string
): Promise<AppRole | null> {
  // Resolve the membership role with the service-role admin client (scoped to
  // THIS user's own company + id, so no cross-tenant exposure). getCompanyId can
  // self-heal tenancy via the admin client when a memberships RLS SELECT gap
  // blocks the user from reading their own row; if role resolution used the
  // RLS-scoped client it would then return null → every module API 403s for a
  // valid member (CEO/co-CEO included). Reading role via admin keeps role
  // resolution consistent with tenancy resolution. Falls back to the RLS client.
  const client = getSupabaseAdmin() ?? supabase;
  const { data, error } = await client
    .from("memberships")
    .select("role")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .limit(1);

  if (error) return null;
  return normalizeAppRole(data?.[0]?.role);
}

export async function getEffectiveRole(): Promise<AppRole | null> {
  const { supabase, companyId, userId } = await getCompanyId();
  const realRole = await resolveRealRole(supabase, companyId, userId);
  if (!realRole) return null;

  const cookieStore = await cookies();
  const e2eRole =
    process.env.NODE_ENV !== "production" || process.env.E2E === "true"
      ? normalizeAppRole(cookieStore.get("e2e_role")?.value)
      : null;
  if (e2eRole) return e2eRole;

  const actingRole = normalizeAppRole(cookieStore.get(ACTING_ROLE_COOKIE)?.value);
  if (!actingRole) return realRole;
  return clampActingRole(realRole, actingRole);
}
