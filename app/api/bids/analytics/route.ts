/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getEffectiveRole } from "@/lib/auth/effectiveRole";

const toNum = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function GET() {
  try {
    const role = await getEffectiveRole();
    if (!role) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { supabase, companyId } = await getCompanyId();
    const bidsRes = await supabase
      .from("bids")
      .select("*")
      .eq("company_id", companyId);
    if (bidsRes.error) return NextResponse.json({ error: bidsRes.error.message }, { status: 400 });

    const rows = bidsRes.data ?? [];
    const stageOf = (row: any) => String(row.stage || row.status || "estimating").toLowerCase();
    const valueOf = (row: any) => toNum(row.amount ?? row.total ?? row.total_amount);
    const isClosed = (stage: string) => stage === "won" || stage === "lost";

    const pipelineRows = rows.filter((row) => !isClosed(stageOf(row)));
    const wonRows = rows.filter((row) => stageOf(row) === "won");
    const closedRows = rows.filter((row) => isClosed(stageOf(row)));
    const pipelineValue = pipelineRows.reduce((s, row) => s + valueOf(row), 0);
    const winRate = closedRows.length > 0 ? round2((wonRows.length / closedRows.length) * 100) : 0;

    let cycleDays = 0;
    if (closedRows.length > 0) {
      const totalDays = closedRows.reduce((sum, row: any) => {
        const from = row.created_at ? new Date(row.created_at).getTime() : 0;
        const to = row.converted_at ? new Date(row.converted_at).getTime() : Date.now();
        if (!from || !to || to < from) return sum;
        return sum + (to - from) / (1000 * 60 * 60 * 24);
      }, 0);
      cycleDays = round2(totalDays / closedRows.length);
    }

    // Keep analytics deterministic and fast in v1; margin detail is populated from version snapshots in handoff.
    const avgEstimatedMargin = 0;

    const visible = role === "admin" || role === "pm";
    return NextResponse.json({
      item: {
        visible,
        role,
        pipeline_value: visible ? round2(pipelineValue) : 0,
        win_rate_percent: visible ? winRate : 0,
        avg_estimated_margin_percent: visible ? avgEstimatedMargin : 0,
        avg_cycle_time_days: visible ? cycleDays : 0,
        counts: {
          opportunities: rows.length,
          open: pipelineRows.length,
          won: wonRows.length,
          lost: rows.filter((row) => stageOf(row) === "lost").length,
        },
      },
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
}
