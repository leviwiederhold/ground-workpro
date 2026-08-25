/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  isOwnerTeamRole,
  normalizeCanonicalTeamRole,
  type CanonicalTeamRole,
} from "./teamRoles.ts";

const isMissingPrimaryOwnerColumn = (error: unknown) =>
  /primary_owner_user_id/i.test(
    typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "")
  );

/**
 * Returns the one authoritative company owner. The membership fallback keeps a
 * rolling code-before-migration deploy usable; the migration itself makes the
 * company column non-null and canonical after rollout.
 */
export async function getPrimaryOwnerUserId(params: {
  db: any;
  companyId: string;
}): Promise<string> {
  const companyResult = await params.db
    .from("companies")
    .select("primary_owner_user_id")
    .eq("id", params.companyId)
    .maybeSingle();

  if (!companyResult.error) {
    return String(companyResult.data?.primary_owner_user_id ?? "").trim();
  }
  if (!isMissingPrimaryOwnerColumn(companyResult.error)) {
    throw new Error(companyResult.error.message);
  }

  const membershipsResult = await params.db
    .from("memberships")
    .select("user_id, role")
    .eq("company_id", params.companyId)
    .order("user_id", { ascending: true });
  if (membershipsResult.error) throw new Error(membershipsResult.error.message);
  const owner = (membershipsResult.data ?? []).find((row: any) =>
    isOwnerTeamRole(row.role)
  );
  return String(owner?.user_id ?? "").trim();
}

export function resolveCompanyTeamRole(params: {
  storedRole: unknown;
  userId: unknown;
  primaryOwnerUserId: unknown;
}): CanonicalTeamRole {
  const role = normalizeCanonicalTeamRole(params.storedRole) ?? "team_member";
  const userId = String(params.userId ?? "").trim();
  const primaryOwnerUserId = String(params.primaryOwnerUserId ?? "").trim();
  if (userId && primaryOwnerUserId && userId === primaryOwnerUserId) return "owner";
  return role === "owner" ? "co_owner" : role;
}

export function isPrimaryOwner(params: {
  userId: unknown;
  primaryOwnerUserId: unknown;
}): boolean {
  const userId = String(params.userId ?? "").trim();
  return Boolean(
    userId && userId === String(params.primaryOwnerUserId ?? "").trim()
  );
}
