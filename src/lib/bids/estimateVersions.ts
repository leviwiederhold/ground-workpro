/* eslint-disable @typescript-eslint/no-explicit-any */
import { getBidSummaryData } from "@/lib/bids/getBidSummaryData";

const n = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

export async function resolveVersionFinancials(input: {
  supabase: any;
  companyId: string;
  bidId: string;
  estimatedRevenue?: number | null;
  subtotalCost?: number | null;
  contingencyPercent?: number | null;
}) {
  const bidSummary = await getBidSummaryData(input.supabase, input.companyId, input.bidId);
  if ("error" in bidSummary) {
    return {
      subtotalCost: n(input.subtotalCost, 0),
      estimatedRevenue: n(input.estimatedRevenue, 0),
      targetMarginPercent: 0,
    };
  }

  const pricing = await input.supabase
    .from("pricing_settings")
    .select("target_margin_percent")
    .eq("company_id", input.companyId)
    .maybeSingle();

  return {
    subtotalCost: n(input.subtotalCost, n(bidSummary.summary?.subtotalCost, 0)),
    estimatedRevenue: n(input.estimatedRevenue, n(bidSummary.summary?.revenue, n((bidSummary as any).bid?.total, 0))),
    targetMarginPercent: n(pricing.data?.target_margin_percent, 0),
  };
}

export function computeVersionTotals(input: {
  subtotalCost: number;
  estimatedRevenue: number;
  contingencyPercent: number;
}) {
  const contingencyAmount = round2(input.subtotalCost * (n(input.contingencyPercent, 0) / 100));
  const totalCost = round2(input.subtotalCost + contingencyAmount);
  const marginPercent = input.estimatedRevenue > 0
    ? round2(((input.estimatedRevenue - totalCost) / input.estimatedRevenue) * 100)
    : 0;
  return {
    contingencyAmount,
    totalCost,
    marginPercent,
  };
}
