import { supabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

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

  const loadMembership = async () => {
    const preferred = await supabase
      .from("memberships")
      .select("company_id")
      .eq("user_id", userData.user.id)
      .order("created_at", { ascending: false })
      .limit(1);
    if (
      preferred.error &&
      /column memberships\.created_at does not exist|Could not find the 'created_at' column/i.test(
        preferred.error.message || ""
      )
    ) {
      return supabase
        .from("memberships")
        .select("company_id")
        .eq("user_id", userData.user.id)
        .order("company_id", { ascending: true })
        .limit(1);
    }
    return preferred;
  };

  let { data: memberships, error: membershipsError } = await loadMembership();

  if (membershipsError) {
    throw new TenantResolverError(membershipsError.message, 400);
  }

  let companyId = memberships?.[0]?.company_id;
  if (!companyId) {
    const email = String(userData.user.email ?? "").trim().toLowerCase();
    if (email) {
      const admin = getSupabaseAdmin();
      const client = admin ?? supabase;
      let inviteEmployee = await client
        .from("employees")
        .select("id, company_id, role")
        .eq("email", email)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (inviteEmployee.error && /created_at/i.test(inviteEmployee.error.message || "")) {
        inviteEmployee = await client
          .from("employees")
          .select("id, company_id, role")
          .eq("email", email)
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle();
      }

      if (!inviteEmployee.error && inviteEmployee.data?.company_id) {
        const roleRaw = String(inviteEmployee.data.role ?? "").toLowerCase();
        const membershipRole =
          roleRaw.includes("admin") || roleRaw.includes("executive") || roleRaw.includes("ceo")
            ? "admin"
            : roleRaw === "pm" || roleRaw.includes("operations") || roleRaw.includes("projectmanager")
              ? "pm"
              : roleRaw.includes("foreman")
                ? "foreman"
                : roleRaw.includes("mechanic")
                  ? "mechanic"
                  : "operator";

        const membershipInsert = await client.from("memberships").insert({
          company_id: inviteEmployee.data.company_id,
          user_id: userData.user.id,
          role: membershipRole,
        });

        if (
          membershipInsert.error &&
          !/duplicate key|unique/i.test(membershipInsert.error.message || "")
        ) {
          throw new TenantResolverError(membershipInsert.error.message || "Failed to create membership", 400);
        }

        const employeeUpdate = await client
          .from("employees")
          .update({ user_id: userData.user.id, role: membershipRole })
          .eq("id", inviteEmployee.data.id)
          .eq("company_id", inviteEmployee.data.company_id);

        if (
          employeeUpdate.error &&
          /Could not find the 'user_id' column/i.test(employeeUpdate.error.message || "")
        ) {
          await client
            .from("employees")
            .update({ role: membershipRole })
            .eq("id", inviteEmployee.data.id)
            .eq("company_id", inviteEmployee.data.company_id);
        }

        const reloaded = await loadMembership();
        memberships = reloaded.data;
        membershipsError = reloaded.error;
        companyId = memberships?.[0]?.company_id;
      }
    }
  }

  if (membershipsError) {
    throw new TenantResolverError(membershipsError.message, 400);
  }

  if (!companyId) {
    throw new TenantResolverError("No company membership found (run bootstrap)", 403);
  }

  return { supabase, companyId, userId: userData.user.id, userEmail: String(userData.user.email ?? "").trim().toLowerCase() };
}
