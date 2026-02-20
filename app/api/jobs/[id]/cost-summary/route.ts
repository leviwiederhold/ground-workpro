/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getJobCostSummary } from "@/lib/job-costing/getJobCostSummary";

const paramsSchema = z.object({
  id: z.string().min(1),
});

const normalizeRouteId = (id: string) => (/^\d+$/.test(id) ? Number(id) : id);

async function syncMarginDriftAlert(
  supabase: any,
  companyId: string,
  jobId: string | number,
  jobName: string,
  summary: {
    isOverBudget: boolean;
    variancePercent: number;
    varianceAmount: number;
    estimatedCost: number;
    actualCost: number;
    marginDriftPercent: number;
  }
) {
  const dedupeKey = `margin_drift:${jobId}`;
  if (!summary.isOverBudget) {
    await supabase
      .from("alerts")
      .delete()
      .eq("company_id", companyId)
      .eq("dedupe_key", dedupeKey);
    return;
  }

  await supabase.from("alerts").upsert(
    {
      company_id: companyId,
      alert_type: "margin_drift",
      title: "Margin drift detected",
      message: `${jobName} is ${summary.variancePercent}% over budget (${summary.varianceAmount >= 0 ? "+" : ""}$${Math.abs(summary.varianceAmount).toFixed(2)})`,
      entity_type: "job",
      entity_id: String(jobId),
      dedupe_key: dedupeKey,
      metadata: {
        estimatedCost: summary.estimatedCost,
        actualCost: summary.actualCost,
        variancePercent: summary.variancePercent,
        marginDriftPercent: summary.marginDriftPercent,
      },
    },
    { onConflict: "company_id,dedupe_key" }
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const routeParams = await params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      return NextResponse.json(
        {
          error: "Validation error",
          details: parsedParams.error.issues.map((issue: { path: Array<string | number>; message: string }) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 422 }
      );
    }

    const jobId = normalizeRouteId(parsedParams.data.id);
    const { supabase, companyId } = await getCompanyId();

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("id, name")
      .eq("company_id", companyId)
      .eq("id", jobId)
      .maybeSingle();

    if (jobError) {
      return NextResponse.json({ error: jobError.message }, { status: 400 });
    }
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const summaryResult = await getJobCostSummary(supabase, companyId, jobId);
    if (!summaryResult.ok) {
      return NextResponse.json({ error: summaryResult.error }, { status: 400 });
    }

    await syncMarginDriftAlert(
      supabase,
      companyId,
      jobId,
      String(job.name ?? "Job"),
      summaryResult.summary
    );

    return NextResponse.json({ item: summaryResult.summary });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
