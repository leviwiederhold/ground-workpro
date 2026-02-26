import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { forbidden, notFound, serverError } from "@/lib/http/errors";
import { okItem } from "@/lib/http/json";
import { getFallbackSafetyOpsSummary } from "@/lib/safety/opsFallbackStore";

export const dynamic = "force-dynamic";

function tenantError(error: TenantResolverError) {
  if (error.status === 404) return notFound(error.message);
  if (error.status === 403) return forbidden(error.message);
  return serverError(error.message);
}

export async function GET() {
  try {
    const { supabase, companyId } = await getCompanyId();

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    weekStart.setHours(0, 0, 0, 0);

    const [openActions, overdueActions, highSeverity, closedThisWeek] = await Promise.all([
      supabase
        .from("safety_actions")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .in("status", ["open", "in_progress"]),
      supabase
        .from("safety_actions")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .in("status", ["open", "in_progress"])
        .lt("due_date", new Date().toISOString().slice(0, 10)),
      supabase
        .from("safety_logs")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("severity", "high")
        .gte("occurred_on", sevenDaysAgo.toISOString().slice(0, 10)),
      supabase
        .from("safety_actions")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("status", "closed")
        .gte("closed_at", weekStart.toISOString()),
    ]);

    const fallback = getFallbackSafetyOpsSummary(companyId);
    if (openActions.error || overdueActions.error || highSeverity.error || closedThisWeek.error) {
      return okItem({
        openHazards: fallback.openHazards,
        overdueActions: fallback.overdueActions,
        highSeverity7d: 0,
        closedThisWeek: fallback.closedThisWeek,
      });
    }

    return okItem({
      openHazards: Number(openActions.count ?? 0) + fallback.openHazards,
      overdueActions: Number(overdueActions.count ?? 0) + fallback.overdueActions,
      highSeverity7d: Number(highSeverity.count ?? 0),
      closedThisWeek: Number(closedThisWeek.count ?? 0) + fallback.closedThisWeek,
    });
  } catch (error) {
    if (error instanceof TenantResolverError) return tenantError(error);
    return serverError();
  }
}
