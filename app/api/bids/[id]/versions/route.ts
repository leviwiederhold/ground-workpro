/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { computeVersionTotals, resolveVersionFinancials } from "@/lib/bids/estimateVersions";

const paramsSchema = z.object({ id: z.string().uuid() });
const lineSchema = z.object({
  description: z.string().trim().min(1),
  amount: z.number().finite().optional().default(0),
});
const riskSchema = z.object({
  title: z.string().trim().min(1),
  owner_user_id: z.string().uuid().nullable().optional(),
  severity: z.enum(["low", "medium", "high"]).default("medium"),
  cost_impact: z.number().finite().optional().default(0),
  status: z.enum(["open", "mitigated", "accepted"]).default("open").optional(),
});

type VersionLineInput = {
  description: string;
  amount?: number;
};

type VersionRiskInput = {
  title: string;
  owner_user_id?: string | null;
  severity: "low" | "medium" | "high";
  cost_impact?: number;
  status?: "open" | "mitigated" | "accepted";
};
const createSchema = z.object({
  name: z.string().trim().min(1).optional(),
  estimated_revenue: z.number().finite().optional(),
  subtotal_cost: z.number().finite().optional(),
  contingency_percent: z.number().finite().nonnegative().optional().default(0),
  assumptions: z.array(lineSchema).optional().default([]),
  exclusions: z.array(lineSchema).optional().default([]),
  alternates: z.array(lineSchema).optional().default([]),
  risks: z.array(riskSchema).optional().default([]),
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
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const parsedParams = paramsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Validation error", details: parsedParams.error.flatten() }, { status: 422 });
    }
    const bidId = parsedParams.data.id;
    const { supabase, companyId } = await getCompanyId();

    const versionsResult = await supabase
      .from("bid_estimate_versions")
      .select("*")
      .eq("company_id", companyId)
      .eq("bid_id", bidId)
      .order("version_no", { ascending: true });
    if (versionsResult.error) return NextResponse.json({ error: versionsResult.error.message }, { status: 400 });

    const versionIds = (versionsResult.data ?? []).map((row: any) => row.id);
    const linesResult = versionIds.length
      ? await supabase
          .from("bid_estimate_version_lines")
          .select("id, version_id, line_type, description, amount")
          .eq("company_id", companyId)
          .in("version_id", versionIds)
      : { data: [], error: null };
    if (linesResult.error) return NextResponse.json({ error: linesResult.error.message }, { status: 400 });

    const risksResult = versionIds.length
      ? await supabase
          .from("bid_estimate_risks")
          .select("id, version_id, title, owner_user_id, severity, status, cost_impact")
          .eq("company_id", companyId)
          .in("version_id", versionIds)
      : { data: [], error: null };
    if (risksResult.error) return NextResponse.json({ error: risksResult.error.message }, { status: 400 });

    const linesByVersion = new Map<string, any[]>();
    for (const row of linesResult.data ?? []) {
      const key = String(row.version_id);
      linesByVersion.set(key, [...(linesByVersion.get(key) ?? []), row]);
    }
    const risksByVersion = new Map<string, any[]>();
    for (const row of risksResult.data ?? []) {
      const key = String(row.version_id);
      risksByVersion.set(key, [...(risksByVersion.get(key) ?? []), row]);
    }

    const items = (versionsResult.data ?? []).map((row: any) => {
      const lines = linesByVersion.get(String(row.id)) ?? [];
      const risks = risksByVersion.get(String(row.id)) ?? [];
      return {
        ...row,
        assumptions: lines.filter((l) => l.line_type === "assumption"),
        exclusions: lines.filter((l) => l.line_type === "exclusion"),
        alternates: lines.filter((l) => l.line_type === "alternate"),
        risks,
        risk_totals: sumRiskTotals(risks),
      };
    });

    return NextResponse.json({ items });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    try {
      await requireRole(["admin", "pm"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const parsedParams = paramsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Validation error", details: parsedParams.error.flatten() }, { status: 422 });
    }
    const parsedBody = createSchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return NextResponse.json({ error: "Validation error", details: parsedBody.error.flatten() }, { status: 422 });
    }

    const bidId = parsedParams.data.id;
    const body = parsedBody.data;
    const { supabase, companyId, userId } = await getCompanyId();

    const bid = await supabase.from("bids").select("id").eq("company_id", companyId).eq("id", bidId).maybeSingle();
    if (bid.error) return NextResponse.json({ error: bid.error.message }, { status: 400 });
    if (!bid.data) return NextResponse.json({ error: "Bid not found" }, { status: 404 });

    const maxVersionRes = await supabase
      .from("bid_estimate_versions")
      .select("version_no")
      .eq("company_id", companyId)
      .eq("bid_id", bidId)
      .order("version_no", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (maxVersionRes.error) return NextResponse.json({ error: maxVersionRes.error.message }, { status: 400 });
    const nextVersionNo = Number(maxVersionRes.data?.version_no || 0) + 1;

    const base = await resolveVersionFinancials({
      supabase,
      companyId,
      bidId,
      estimatedRevenue: body.estimated_revenue,
      subtotalCost: body.subtotal_cost,
      contingencyPercent: body.contingency_percent,
    });
    const totals = computeVersionTotals({
      subtotalCost: base.subtotalCost,
      estimatedRevenue: base.estimatedRevenue,
      contingencyPercent: body.contingency_percent ?? 0,
    });

    const insertVersion = await supabase
      .from("bid_estimate_versions")
      .insert({
        company_id: companyId,
        bid_id: bidId,
        version_no: nextVersionNo,
        name: body.name || `v${nextVersionNo}`,
        status: "draft",
        estimated_revenue: base.estimatedRevenue,
        subtotal_cost: base.subtotalCost,
        contingency_percent: body.contingency_percent ?? 0,
        contingency_amount: totals.contingencyAmount,
        total_cost: totals.totalCost,
        margin_percent: totals.marginPercent,
        target_margin_percent: base.targetMarginPercent,
        is_below_target: totals.marginPercent < base.targetMarginPercent,
        created_by: userId,
      })
      .select("*")
      .single();
    if (insertVersion.error || !insertVersion.data) {
      return NextResponse.json({ error: insertVersion.error?.message || "Failed to create version" }, { status: 400 });
    }

    const lineRows = [
      ...body.assumptions.map((row: VersionLineInput) => ({ ...row, line_type: "assumption" })),
      ...body.exclusions.map((row: VersionLineInput) => ({ ...row, line_type: "exclusion" })),
      ...body.alternates.map((row: VersionLineInput) => ({ ...row, line_type: "alternate" })),
    ].map((row) => ({
      company_id: companyId,
      version_id: insertVersion.data.id,
      line_type: row.line_type,
      description: row.description,
      amount: row.amount ?? 0,
    }));
    if (lineRows.length > 0) {
      const lineInsert = await supabase.from("bid_estimate_version_lines").insert(lineRows);
      if (lineInsert.error) return NextResponse.json({ error: lineInsert.error.message }, { status: 400 });
    }

    const riskRows = body.risks.map((row: VersionRiskInput) => ({
      company_id: companyId,
      version_id: insertVersion.data.id,
      title: row.title,
      owner_user_id: row.owner_user_id || null,
      severity: row.severity,
      status: row.status || "open",
      cost_impact: row.cost_impact ?? 0,
    }));
    if (riskRows.length > 0) {
      const riskInsert = await supabase.from("bid_estimate_risks").insert(riskRows);
      if (riskInsert.error) return NextResponse.json({ error: riskInsert.error.message }, { status: 400 });
    }

    return NextResponse.json({ item: insertVersion.data }, { status: 201 });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
}
