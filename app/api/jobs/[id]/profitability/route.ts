/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getJobCostSummary } from "@/lib/job-costing/getJobCostSummary";
import { getBidSummaryData } from "@/lib/bids/getBidSummaryData";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { okItem } from "@/lib/http/json";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const normalizeId = (id: string) => (/^\d+$/.test(id) ? Number(id) : id);

const toNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const buildValidationDetails = (issues: Array<{ path: Array<string | number>; message: string }>) =>
  issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));

async function findAcceptedBid(supabase: any, companyId: string, jobId: string | number) {
  const attempts = [
    () =>
      supabase
        .from("bids")
        .select("id, status")
        .eq("company_id", companyId)
        .eq("job_id", jobId)
        .eq("status", "accepted")
        .order("created_at", { ascending: false })
        .limit(1),
    () =>
      supabase
        .from("bids")
        .select("id, status")
        .eq("company_id", companyId)
        .eq("jobId", jobId)
        .eq("status", "accepted")
        .order("created_at", { ascending: false })
        .limit(1),
    () =>
      supabase
        .from("bids")
        .select("id, status")
        .eq("company_id", companyId)
        .eq("job_id", jobId)
        .eq("status", "accepted")
        .order("id", { ascending: false })
        .limit(1),
    () =>
      supabase
        .from("bids")
        .select("id, status")
        .eq("company_id", companyId)
        .eq("jobId", jobId)
        .eq("status", "accepted")
        .order("id", { ascending: false })
        .limit(1),
  ];

  for (const run of attempts) {
    const result = await run();
    if (!result.error) {
      return { bid: result.data?.[0] ?? null as any, error: null as string | null };
    }
    const message = String(result.error.message || "").toLowerCase();
    if (message.includes("could not find the") || message.includes("does not exist")) {
      continue;
    }
    return { bid: null as any, error: result.error.message || "Failed to load bid" };
  }

  return { bid: null as any, error: null as string | null };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const routeParams = await params;
    const parsed = paramsSchema.safeParse(routeParams);
    if (!parsed.success) {
      return validationError(buildValidationDetails(parsed.error.issues));
    }

    const jobId = normalizeId(parsed.data.id);
    const { supabase, companyId } = await getCompanyId();

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", jobId)
      .maybeSingle();

    if (jobError) return serverError();
    if (!job) return notFound("Job not found");

    const costSummary = await getJobCostSummary(supabase, companyId, jobId);
    if (!costSummary.ok) return serverError();

    const acceptedBidResult = await findAcceptedBid(supabase, companyId, jobId);
    if (acceptedBidResult.error) return serverError();

    let revenueToDate = 0;
    let revenueSource: "accepted_bid" | "contract_value" | "none" = "none";
    let acceptedBidId: string | number | null = null;

    if (acceptedBidResult.bid?.id !== undefined && acceptedBidResult.bid?.id !== null) {
      const bidId = acceptedBidResult.bid.id as string | number;
      const bidSummaryResult = await getBidSummaryData(supabase, companyId, bidId);
      if ("error" in bidSummaryResult) return serverError();
      revenueToDate = round2(toNumber(bidSummaryResult.summary?.revenue));
      revenueSource = "accepted_bid";
      acceptedBidId = bidId;
    } else {
      const contractValue = toNumber(
        (job as Record<string, unknown>).contract_value ??
          (job as Record<string, unknown>).contractValue ??
          (job as Record<string, unknown>).budget
      );
      if (contractValue > 0) {
        revenueToDate = round2(contractValue);
        revenueSource = "contract_value";
      }
    }

    const costToDate = round2(toNumber(costSummary.summary.actualTotalCost));
    const profit = round2(revenueToDate - costToDate);
    const marginPercent =
      revenueToDate > 0 ? round2((profit / revenueToDate) * 100) : null;

    return okItem({
      job_id: jobId,
      cost_to_date: costToDate,
      revenue_to_date: revenueToDate,
      profit,
      margin_percent: marginPercent,
      revenue_source: revenueSource,
      accepted_bid_id: acceptedBidId,
    });
  } catch (error) {
    if (error instanceof TenantResolverError) return forbidden();
    return serverError();
  }
}
