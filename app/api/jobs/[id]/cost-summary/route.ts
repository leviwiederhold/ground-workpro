/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getJobCostSummary } from "@/lib/job-costing/getJobCostSummary";
import { deleteFallbackAlert, upsertFallbackAlert } from "@/lib/alerts/fallbackStore";

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
    const deletion = await supabase
      .from("alerts")
      .delete()
      .eq("company_id", companyId)
      .eq("dedupe_key", dedupeKey);
    if (
      deletion.error &&
      String(deletion.error.message || "").toLowerCase().includes("alerts") &&
      String(deletion.error.message || "").toLowerCase().includes("does not exist")
    ) {
      deleteFallbackAlert(companyId, dedupeKey);
    }
    return;
  }

  const payload = {
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
  };

  const upsert = await supabase.from("alerts").upsert(
    payload,
    { onConflict: "company_id,dedupe_key" }
  );

  if (upsert.error) {
    upsertFallbackAlert(companyId, {
      alert_type: payload.alert_type,
      title: payload.title,
      message: payload.message,
      entity_type: payload.entity_type,
      entity_id: payload.entity_id,
      dedupe_key: payload.dedupe_key,
      metadata: payload.metadata,
    });
  }
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
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const summaryResult = await getJobCostSummary(supabase, companyId, jobId);
    if (!summaryResult.ok) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
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
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
