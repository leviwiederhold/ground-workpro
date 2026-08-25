import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { logAuditEvent } from "@/lib/audit/logAuditEvent";
import { enqueueNotifications } from "@/lib/notifications/enqueue";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const bodySchema = z.object({
  job_name: z.string().min(1).optional(),
});

type JobNotesMeta = {
  client?: string;
  source_bid_id?: string;
};

const JOB_META_PREFIX = "\n<!--GW_META:";
const JOB_META_SUFFIX = "-->";

function buildJobNotes(plainNotes: string, meta: JobNotesMeta): string {
  const compactMeta: JobNotesMeta = {};
  if (meta.client) compactMeta.client = meta.client;
  if (meta.source_bid_id) compactMeta.source_bid_id = meta.source_bid_id;
  const base = plainNotes.trimEnd();
  if (Object.keys(compactMeta).length === 0) return base;
  return `${base}${JOB_META_PREFIX}${JSON.stringify(compactMeta)}${JOB_META_SUFFIX}`;
}

async function insertJobWithColumnFallback(
  supabase: Awaited<ReturnType<typeof getCompanyId>>["supabase"],
  payload: Record<string, unknown>
) {
  const insertPayload: Record<string, unknown> = { ...payload };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = await supabase
      .from("jobs")
      .insert(insertPayload)
      .select("id, name, status, notes")
      .single();
    if (!result.error) return result;

    const message = result.error.message ?? "";
    const missingColumn = message.match(/Could not find the '([^']+)' column/i)?.[1];
    if (!missingColumn) return result;
    if (!(missingColumn in insertPayload)) return result;
    delete insertPayload[missingColumn];
  }

  return supabase
    .from("jobs")
    .insert(insertPayload)
    .select("id, name, status, notes")
    .single();
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
      const existingJobResult = await supabase
        .from("jobs")
        .select("id, name, status, notes")
        .eq("company_id", companyId)
        .eq("id", bid.converted_job_id)
        .maybeSingle();
      if (!existingJobResult.error && existingJobResult.data) {
        return NextResponse.json({ item: { job_id: bid.converted_job_id, job: existingJobResult.data, alreadyConverted: true } });
      }
    }

    const now = new Date().toISOString();
    const jobName = parsedBody.data.job_name || bid.title || bid.project_name || "Converted Job";
    const rawNotes = [
      `Converted from bid ${bid.id}`,
      bid.client ? `Client: ${bid.client}` : "",
      bid.bid_date ? `Bid Date: ${bid.bid_date}` : "",
      bid.notes ? `Bid Notes: ${bid.notes}` : "",
    ].filter(Boolean).join("\n");
    const notes = buildJobNotes(rawNotes, {
      client: typeof bid.client === "string" ? bid.client : undefined,
      source_bid_id: String(bidId),
    });

    const baseInsertPayload = {
      company_id: companyId,
      name: jobName,
      status: "in_progress",
      notes,
      created_by: userId,
    };

    const jobInsert = await insertJobWithColumnFallback(supabase, baseInsertPayload);

    if (jobInsert.error || !jobInsert.data) {
      const fallbackInsert = await insertJobWithColumnFallback(supabase, {
        company_id: companyId,
        name: jobName,
        status: "in_progress",
        notes,
      });
      if (fallbackInsert.error || !fallbackInsert.data) {
        return NextResponse.json({ error: fallbackInsert.error?.message || "Failed to create job" }, { status: 400 });
      }
      const updateFallback = await supabase
        .from("bids")
        .update({
          job_id: fallbackInsert.data.id,
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
      try {
        const membersResult = await supabase
          .from("memberships")
          .select("user_id, role")
          .eq("company_id", companyId)
          .in("role", ["owner", "co_owner", "administrator", "manager", "ceo", "admin", "pm"]);
        if (!membersResult.error) {
          const recipientUserIds = (membersResult.data ?? [])
            .map((row) => String((row as { user_id?: string }).user_id ?? ""))
            .filter(Boolean);
          await enqueueNotifications({
            supabase,
            companyId,
            userIds: recipientUserIds,
            type: "bid_won",
            payload: {
              bidId,
              bidTitle: bid.title ?? bid.project_name ?? "Bid",
              jobId: fallbackInsert.data.id,
              href: `/bids`,
            },
            entityType: "bid",
            entityId: bidId,
            actorUserId: userId,
          });
        }
      } catch {
        // Non-blocking notification fanout.
      }
      return NextResponse.json({ item: { job_id: fallbackInsert.data.id, job: fallbackInsert.data } });
    }

    const updateResult = await supabase
      .from("bids")
      .update({
        job_id: jobInsert.data.id,
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
    try {
      const membersResult = await supabase
        .from("memberships")
        .select("user_id, role")
        .eq("company_id", companyId)
        .in("role", ["owner", "co_owner", "administrator", "manager", "ceo", "admin", "pm"]);
      if (!membersResult.error) {
        const recipientUserIds = (membersResult.data ?? [])
          .map((row) => String((row as { user_id?: string }).user_id ?? ""))
          .filter(Boolean);
        await enqueueNotifications({
          supabase,
          companyId,
          userIds: recipientUserIds,
          type: "bid_won",
          payload: {
            bidId,
            bidTitle: bid.title ?? bid.project_name ?? "Bid",
            jobId: jobInsert.data.id,
            href: `/bids`,
          },
          entityType: "bid",
          entityId: bidId,
          actorUserId: userId,
        });
      }
    } catch {
      // Non-blocking notification fanout.
    }

    return NextResponse.json({ item: { job_id: jobInsert.data.id, job: jobInsert.data } });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
}
