import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { forbidden, notFound, serverError } from "@/lib/http/errors";

function tenantError(error: TenantResolverError) {
  if (error.status === 404) return notFound(error.message);
  if (error.status === 403) return forbidden(error.message);
  return serverError(error.message);
}

export async function GET() {
  try {
    const { supabase, companyId, userId } = await getCompanyId();

    const memberships = await supabase
      .from("memberships")
      .select("user_id, role")
      .eq("company_id", companyId)
      .neq("user_id", userId)
      .order("created_at", { ascending: true });

    if (memberships.error) return serverError();

    const userIds = (memberships.data ?? []).map((row) => String(row.user_id));
    const profiles = userIds.length
      ? await supabase.from("profiles").select("id, full_name").in("id", userIds)
      : { data: [], error: null };

    if (profiles.error) return serverError();

    const nameById = new Map((profiles.data ?? []).map((profile) => [String(profile.id), String(profile.full_name ?? "")])) as Map<string, string>;

    return Response.json({
      items: (memberships.data ?? []).map((row) => ({
        userId: row.user_id,
        role: row.role,
        displayName: nameById.get(String(row.user_id)) || "Team Member",
      })),
    });
  } catch (error) {
    if (error instanceof TenantResolverError) return tenantError(error);
    return serverError();
  }
}
