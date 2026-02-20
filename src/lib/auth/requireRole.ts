import { getCompanyId } from "@/lib/tenant/getCompanyId";

export type Role = "admin" | "pm" | "foreman" | "mechanic" | "operator";

export class ForbiddenError extends Error {
  status: number;

  constructor(message = "Forbidden") {
    super(message);
    this.status = 403;
  }
}

export function hasRole(role: Role, allowed: Role[]): boolean {
  return allowed.includes(role);
}

export async function requireRole(allowed: Role[]): Promise<{
  userId: string;
  companyId: string;
  role: Role;
}> {
  const { supabase, companyId, userId } = await getCompanyId();

  const { data: membership, error } = await supabase
    .from("memberships")
    .select("role")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new ForbiddenError();
  }

  const role = membership?.role as Role | undefined;
  if (!role || !hasRole(role, allowed)) {
    throw new ForbiddenError();
  }

  return { userId, companyId, role };
}
