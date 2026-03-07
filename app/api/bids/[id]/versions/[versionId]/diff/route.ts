/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";

const paramsSchema = z.object({
  id: z.string().uuid(),
  versionId: z.string().uuid(),
});

const sumRiskTotals = (risks: Array<{ severity: string; cost_impact: number }>) =>
  risks.reduce(
    (acc, row) => {
      acc.total += Number(row.cost_impact || 0);
      acc[row.severity] = (acc[row.severity] ?? 0) + 1;
      return acc;
    },
    { total: 0, low: 0, medium: 0, high: 0 } as Record<string, number>
  );

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  try {
    const parsedParams = paramsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Validation error", details: parsedParams.error.flatten() }, { status: 422 });
    }
    const compareTo = new URL(request.url).searchParams.get("compareTo");
    if (!compareTo) return NextResponse.json({ error: "compareTo is required" }, { status: 422 });

    const { supabase, companyId } = await getCompanyId();
    const versions = await supabase
      .from("bid_estimate_versions")
      .select("*")
      .eq("company_id", companyId)
      .eq("bid_id", parsedParams.data.id)
      .in("id", [parsedParams.data.versionId, compareTo]);
    if (versions.error) return NextResponse.json({ error: versions.error.message }, { status: 400 });

    const versionA = (versions.data ?? []).find((row: any) => String(row.id) === parsedParams.data.versionId);
    const versionB = (versions.data ?? []).find((row: any) => String(row.id) === String(compareTo));
    if (!versionA || !versionB) return NextResponse.json({ error: "Version not found" }, { status: 404 });

    const riskRows = await supabase
      .from("bid_estimate_risks")
      .select("version_id, severity, cost_impact")
      .eq("company_id", companyId)
      .in("version_id", [versionA.id, versionB.id]);
    if (riskRows.error) return NextResponse.json({ error: riskRows.error.message }, { status: 400 });

    const riskA = sumRiskTotals((riskRows.data ?? []).filter((r: any) => String(r.version_id) === String(versionA.id)));
    const riskB = sumRiskTotals((riskRows.data ?? []).filter((r: any) => String(r.version_id) === String(versionB.id)));

    return NextResponse.json({
      item: {
        fromVersionId: versionB.id,
        toVersionId: versionA.id,
        delta: {
          estimated_revenue: Number(versionA.estimated_revenue || 0) - Number(versionB.estimated_revenue || 0),
          subtotal_cost: Number(versionA.subtotal_cost || 0) - Number(versionB.subtotal_cost || 0),
          contingency_amount: Number(versionA.contingency_amount || 0) - Number(versionB.contingency_amount || 0),
          total_cost: Number(versionA.total_cost || 0) - Number(versionB.total_cost || 0),
          margin_percent: Number(versionA.margin_percent || 0) - Number(versionB.margin_percent || 0),
        },
        risk_totals: {
          from: riskB,
          to: riskA,
          delta: {
            total: riskA.total - riskB.total,
            low: riskA.low - riskB.low,
            medium: riskA.medium - riskB.medium,
            high: riskA.high - riskB.high,
          },
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
