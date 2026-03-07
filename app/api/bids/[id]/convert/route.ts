import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { logAuditEvent } from "@/lib/audit/logAuditEvent";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const bodySchema = z.object({
  job_name: z.string().min(1).optional(),
});

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

    const body = await request.json().catch(() => ({}));
    const parsedBody = bodySchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json({ error: "Validation error", details: parsedBody.error.flatten() }, { status: 422 });
    }

    const bidId = parsedParams.data.id;
    const { supabase, companyId, userId } = await getCompanyId();

    const bidResult = await supabase
      .from("bids")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", bidId)
      .maybeSingle();
    if (bidResult.error) return NextResponse.json({ error: bidResult.error.message }, { status: 400 });
    if (!bidResult.data) return NextResponse.json({ error: "Bid not found" }, { status: 404 });

    const bid = bidResult.data;
    if (bid.converted_job_id) {
      return NextResponse.json({ item: { job_id: bid.converted_job_id, alreadyConverted: true } });
    }

    const now = new Date().toISOString();
    const jobName = parsedBody.data.job_name || bid.title || bid.project_name || "Converted Job";
    const notes = [
      `Converted from bid ${bid.id}`,
      bid.client ? `Client: ${bid.client}` : "",
      bid.bid_date ? `Bid Date: ${bid.bid_date}` : "",
      bid.notes ? `Bid Notes: ${bid.notes}` : "",
    ].filter(Boolean).join("\n");

    const jobInsert = await supabase
      .from("jobs")
      .insert({
        company_id: companyId,
        name: jobName,
        status: "draft",
        notes,
        client: bid.client ?? "",
        created_by: userId,
      })
      .select("id, name, status")
      .single();

    if (jobInsert.error || !jobInsert.data) {
      const fallbackInsert = await supabase
        .from("jobs")
        .insert({
          company_id: companyId,
          name: jobName,
          status: "draft",
          notes,
        })
        .select("id, name, status")
        .single();
      if (fallbackInsert.error || !fallbackInsert.data) {
        return NextResponse.json({ error: fallbackInsert.error?.message || "Failed to create job" }, { status: 400 });
      }
      const updateFallback = await supabase
        .from("bids")
        .update({
          converted_job_id: fallbackInsert.data.id,
          converted_at: now,
          stage: "won",
          status: "accepted",
          review_approved_at: bid.review_approved_at ?? now,
        })
        .eq("company_id", companyId)
        .eq("id", bidId);
      if (updateFallback.error) return NextResponse.json({ error: updateFallback.error.message }, { status: 400 });
      await logAuditEvent({
        supabase,
        companyId,
        actorUserId: userId,
        eventType: "bid.converted",
        entityType: "bid",
        entityId: bidId,
        before: {
          stage: bid.stage ?? null,
          status: bid.status ?? null,
          converted_job_id: bid.converted_job_id ?? null,
        },
        after: {
          stage: "won",
          status: "accepted",
          converted_job_id: fallbackInsert.data.id,
        },
        metadata: {
          job_id: fallbackInsert.data.id,
          job_name: fallbackInsert.data.name ?? null,
        },
      });
      return NextResponse.json({ item: { job_id: fallbackInsert.data.id, job: fallbackInsert.data } });
    }

    const updateResult = await supabase
      .from("bids")
      .update({
        converted_job_id: jobInsert.data.id,
        converted_at: now,
        stage: "won",
        status: "accepted",
        review_approved_at: bid.review_approved_at ?? now,
      })
      .eq("company_id", companyId)
      .eq("id", bidId);
    if (updateResult.error) return NextResponse.json({ error: updateResult.error.message }, { status: 400 });
    await logAuditEvent({
      supabase,
      companyId,
      actorUserId: userId,
      eventType: "bid.converted",
      entityType: "bid",
      entityId: bidId,
      before: {
        stage: bid.stage ?? null,
        status: bid.status ?? null,
        converted_job_id: bid.converted_job_id ?? null,
      },
      after: {
        stage: "won",
        status: "accepted",
        converted_job_id: jobInsert.data.id,
      },
      metadata: {
        job_id: jobInsert.data.id,
        job_name: jobInsert.data.name ?? null,
      },
    });

    return NextResponse.json({ item: { job_id: jobInsert.data.id, job: jobInsert.data } });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
}
