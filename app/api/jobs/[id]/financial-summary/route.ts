/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getEffectiveRole } from "@/lib/auth/effectiveRole";
import { requireRole } from "@/lib/auth/requireRole";
import { getRoleScopedJobIds } from "@/lib/jobs/roleScope";
import { getJobCostSummary } from "@/lib/job-costing/getJobCostSummary";
import { getBidSummaryData } from "@/lib/bids/getBidSummaryData";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const normalizeRouteId = (id: string) => (/^\d+$/.test(id) ? Number(id) : id);
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const toNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const buildValidationDetails = (issues: Array<{ path: Array<string | number>; message: string }>) =>
  issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));

type SummarySources = {
  budget: "accepted_bid" | "job_field" | "target_margin" | "none";
  spent: "rollup" | "ledger" | "none";
  revenue: "accepted_bid" | "contract_value" | "none";
};

function hiddenResponse() {
  return {
    item: {
      budgetCost: 0,
      spentCost: 0,
      remainingCost: 0,
      contractValue: 0,
      revenueTotal: 0,
      profit: 0,
      marginPct: 0,
      sources: {
        budget: "none",
        spent: "none",
        revenue: "none",
      } satisfies SummarySources,
      visible: false,
    },
  };
}

function normalizeTargetMarginPct(value: unknown) {
  const raw = toNumber(value);
  if (raw <= 0) return 0;
  if (raw <= 1) return raw;
  if (raw <= 100) return raw / 100;
  return 0;
}

const isMissingSchemaError = (errorMessage: string) => {
  const message = errorMessage.toLowerCase();
  return (
    message.includes("could not find the") ||
    (message.includes("column") && message.includes("does not exist")) ||
    (message.includes("relation") && message.includes("does not exist"))
  );
};

async function findAcceptedBidId(supabase: any, companyId: string, jobId: string | number) {
  const attempts = [
    () =>
      supabase
        .from("bids")
        .select("id")
        .eq("company_id", companyId)
        .eq("job_id", jobId)
        .eq("status", "accepted")
        .order("created_at", { ascending: false })
        .limit(1),
    () =>
      supabase
        .from("bids")
        .select("id")
        .eq("company_id", companyId)
        .eq("jobId", jobId)
        .eq("status", "accepted")
        .order("created_at", { ascending: false })
        .limit(1),
    () =>
      supabase
        .from("bids")
        .select("id")
        .eq("company_id", companyId)
        .eq("job_id", jobId)
        .eq("status", "accepted")
        .order("id", { ascending: false })
        .limit(1),
    () =>
      supabase
        .from("bids")
        .select("id")
        .eq("company_id", companyId)
        .eq("jobId", jobId)
        .eq("status", "accepted")
        .order("id", { ascending: false })
        .limit(1),
  ];

  for (const run of attempts) {
    const result = await run();
    if (!result.error) {
      return result.data?.[0]?.id ?? null;
    }
    if (isMissingSchemaError(result.error.message || "")) continue;
    throw new Error(result.error.message || "Failed to load accepted bid");
  }

  return null;
}

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireRole(["admin", "pm", "foreman", "mechanic", "operator"]);

    const parsedParams = paramsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json(
        { error: "Validation error", details: buildValidationDetails(parsedParams.error.issues) },
        { status: 422 }
      );
    }

    const jobId = normalizeRouteId(parsedParams.data.id);
    const { supabase, companyId, userId } = await getCompanyId();
    const effectiveRole = await getEffectiveRole();
    if (!effectiveRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const scopedJobIds = await getRoleScopedJobIds(supabase, companyId, userId, effectiveRole);
    if (scopedJobIds && !scopedJobIds.includes(String(jobId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", jobId)
      .maybeSingle();

    if (jobError) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (!(effectiveRole === "admin" || effectiveRole === "pm")) {
      return NextResponse.json(hiddenResponse());
    }

    const sources: SummarySources = {
      budget: "none",
      spent: "none",
      revenue: "none",
    };

    let revenueTotal = 0;
    let contractValue = toNumber((job as Record<string, unknown>).contract_value);
    let acceptedBidEstimatedCost = 0;

    const acceptedBidId = await findAcceptedBidId(supabase, companyId, jobId);
    if (acceptedBidId !== null && acceptedBidId !== undefined) {
      const bidSummary = await getBidSummaryData(supabase, companyId, acceptedBidId);
      if (!("error" in bidSummary)) {
        revenueTotal = round2(toNumber(bidSummary.summary?.revenue));
        acceptedBidEstimatedCost = round2(toNumber(bidSummary.summary?.subtotalCost));
        sources.revenue = "accepted_bid";
      }
    }

    if (sources.revenue === "none") {
      if (contractValue > 0) {
        revenueTotal = round2(contractValue);
        sources.revenue = "contract_value";
      } else {
        revenueTotal = 0;
      }
    }

    if (contractValue <= 0) {
      contractValue = revenueTotal > 0 ? revenueTotal : 0;
    }
    contractValue = round2(contractValue);

    let spentCost = 0;
    const costSummary = await getJobCostSummary(supabase, companyId, jobId);
    if (costSummary.ok) {
      spentCost = round2(toNumber(costSummary.summary.actualTotalCost));
      sources.spent = "rollup";
    } else {
      // TODO(job cost ledger): replace fallback with ledger-based actuals once ledger lands.
      spentCost = 0;
      sources.spent = "none";
    }

    let budgetCost = 0;
    if (acceptedBidEstimatedCost > 0) {
      budgetCost = acceptedBidEstimatedCost;
      sources.budget = "accepted_bid";
    } else {
      const jobBudgetCost = toNumber((job as Record<string, unknown>).budget_cost);
      if (jobBudgetCost > 0) {
        budgetCost = round2(jobBudgetCost);
        sources.budget = "job_field";
      } else if (revenueTotal > 0) {
        const { data: pricingSettings, error: pricingError } = await supabase
          .from("pricing_settings")
          .select("target_margin_percent")
          .eq("company_id", companyId)
          .maybeSingle();
        if (!pricingError && pricingSettings) {
          const targetMarginPct = normalizeTargetMarginPct(pricingSettings.target_margin_percent);
          if (targetMarginPct > 0) {
            budgetCost = round2(revenueTotal * (1 - targetMarginPct));
            sources.budget = "target_margin";
          }
        }
      }
    }

    const remainingCost = round2(budgetCost - spentCost);
    const profit = round2(revenueTotal - spentCost);
    const marginPct = revenueTotal > 0 ? round2((profit / revenueTotal) * 100) : 0;

    return NextResponse.json({
      item: {
        budgetCost,
        spentCost,
        remainingCost,
        contractValue,
        revenueTotal,
        profit,
        marginPct,
        sources,
        visible: true,
      },
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
