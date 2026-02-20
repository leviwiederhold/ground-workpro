/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { buildAlertCandidates, generateAlertsForCompany } from "@/lib/alerts/generateAlerts";
import { syncFallbackAlerts } from "@/lib/alerts/fallbackStore";

const mapAlert = (row: any) => ({
  id: row.id,
  alert_type: row.alert_type,
  title: row.title ?? "",
  message: row.message ?? "",
  entity_type: row.entity_type ?? "",
  entity_id: row.entity_id ?? null,
  metadata: row.metadata ?? {},
  is_read: Boolean(row.is_read),
  read_at: row.read_at ?? null,
  created_at: row.created_at ?? null,
  updated_at: row.updated_at ?? null,
});

export async function GET() {
  try {
    const { supabase, companyId } = await getCompanyId();

    const generated = await generateAlertsForCompany(supabase, companyId);
    if (!generated.ok) {
      const message = String(generated.error || "").toLowerCase();
      if (!(message.includes("alerts") && (message.includes("does not exist") || message.includes("not find")))) {
        return NextResponse.json({ error: generated.error }, { status: 400 });
      }

      const [inventoryResult, workOrdersResult] = await Promise.all([
        supabase.from("inventory").select("*").eq("company_id", companyId),
        supabase.from("work_orders").select("*").eq("company_id", companyId),
      ]);
      if (inventoryResult.error) {
        return NextResponse.json({ error: inventoryResult.error.message }, { status: 400 });
      }
      if (workOrdersResult.error) {
        return NextResponse.json({ error: workOrdersResult.error.message }, { status: 400 });
      }

      const fallback = syncFallbackAlerts(
        companyId,
        buildAlertCandidates(inventoryResult.data ?? [], workOrdersResult.data ?? [])
      );
      return NextResponse.json({ items: fallback.map(mapAlert) });
    }

    let result = await supabase
      .from("alerts")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (result.error?.message?.toLowerCase().includes("created_at")) {
      result = await supabase
        .from("alerts")
        .select("*")
        .eq("company_id", companyId)
        .order("id", { ascending: false });
    }

    const { data, error } = result;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ items: (data ?? []).map(mapAlert) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
