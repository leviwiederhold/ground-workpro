/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/requireRole";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getFallbackAuditLogs } from "@/lib/audit/fallbackStore";

const mapAuditLog = (row: any) => ({
  id: row.id,
  company_id: row.company_id ?? null,
  actor_user_id: row.actor_user_id ?? null,
  action: row.action ?? row.event_type ?? row.event ?? "",
  event_type: row.event_type ?? row.event ?? "",
  entity_type: row.entity_type ?? null,
  entity_id: row.entity_id ?? null,
  before_data: row.before_data ?? {},
  after_data: row.after_data ?? {},
  metadata: row.metadata ?? {},
  created_at: row.created_at ?? null,
});

export async function GET() {
  try {
    try {
      await requireRole(["admin", "pm"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { supabase, companyId } = await getCompanyId();

    let result = await supabase
      .from("audit_logs")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (result.error?.message?.toLowerCase().includes("created_at")) {
      result = await supabase
        .from("audit_logs")
        .select("*")
        .eq("company_id", companyId)
        .order("id", { ascending: false })
        .limit(200);
    }

    if (result.error) {
      const message = String(result.error.message || "").toLowerCase();
      if (message.includes("audit_logs") && (message.includes("does not exist") || message.includes("not find"))) {
        return NextResponse.json({ items: getFallbackAuditLogs(companyId) });
      }
      return NextResponse.json({ error: result.error.message }, { status: 400 });
    }

    const dbItems = (result.data ?? []).map(mapAuditLog);
    if (dbItems.length === 0) {
      return NextResponse.json({ items: getFallbackAuditLogs(companyId) });
    }
    return NextResponse.json({ items: dbItems });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
