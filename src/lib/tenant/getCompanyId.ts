import { supabaseServer } from "@/lib/supabase/server";
import * as Sentry from "@sentry/nextjs";

export class TenantResolverError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function getCompanyId() {
  const supabase = await supabaseServer();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    throw new TenantResolverError("Not authenticated", 401);
  }

  const { data: memberships, error: membershipsError } = await supabase
    .from("memberships")
    .select("company_id")
    .eq("user_id", userData.user.id)
    .order("company_id", { ascending: true })
    .limit(1);

  if (membershipsError) {
    throw new TenantResolverError(membershipsError.message, 400);
  }

  const companyId = memberships?.[0]?.company_id;
  if (!companyId) {
    throw new TenantResolverError(
      "No company membership found (run bootstrap)",
      403
    );
  }

  Sentry.setUser({ id: userData.user.id });
  Sentry.setTag("companyId", String(companyId));
  Sentry.setTag("userId", String(userData.user.id));

  return { supabase, companyId, userId: userData.user.id };
}
