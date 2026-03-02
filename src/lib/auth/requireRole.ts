import { getCompanyId } from "@/lib/tenant/getCompanyId";
import { getEffectiveRole } from "@/lib/auth/effectiveRole";
import * as Sentry from "@sentry/nextjs";

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
  const { companyId, userId } = await getCompanyId();
  const role = (await getEffectiveRole()) as Role | null;
  if (!role || !hasRole(role, allowed)) {
    throw new ForbiddenError();
  }

  Sentry.setTag("role", role);

  return { userId, companyId, role };
}
