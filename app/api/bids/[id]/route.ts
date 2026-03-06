/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { logAuditEvent } from "@/lib/audit/logAuditEvent";

const bidStatusSchema = z.enum([
  "draft",
  "pending",
  "submitted",
  "sent",
  "accepted",
  "rejected",
  "archived",
  "won",
  "lost",
  "canceled",
]);

const updateBidSchema = z
  .object({
    title: z.string().min(1).optional(),
    status: bidStatusSchema.optional(),
    job_id: z.union([z.string(), z.number()]).nullable().optional(),
    client: z.string().optional(),
    bid_date: z.union([z.string(), z.date()]).optional(),
    probability: z.coerce.number().min(0).max(100).optional(),
    notes: z.string().optional(),
    stage: z.enum(["lead", "qualified", "estimating", "review", "won", "lost"]).optional(),
    owner_user_id: z.string().nullable().optional(),
    due_date: z.union([z.string(), z.date()]).nullable().optional(),
    review_ready: z.boolean().optional(),
    review_approved: z.boolean().optional(),
  })
  .refine((value: any) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

const normalizeRouteId = (id: string) => (/^\d+$/.test(id) ? Number(id) : id);

const normalizeId = (id: unknown) => {
  if (id === null || id === undefined || id === "") return null;
  if (typeof id === "number") return id;
  if (typeof id === "string" && /^\d+$/.test(id)) return Number(id);
  return id;
};

const normalizeNumber = (value: unknown, fallback = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const normalizeDate = (value: unknown) => {
  if (!value || typeof value !== "string") return new Date().toISOString().slice(0, 10);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
};

const mapBid = (row: any) => ({
  id: row.id,
  title: row.title ?? row.project_name ?? "",
  projectName: row.title ?? row.project_name ?? "",
  client: row.client ?? row.client_name ?? "",
  bid_date: row.bid_date ?? null,
  bidDate: row.bid_date ?? row.bidDate ?? null,
  subtotal: normalizeNumber(row.subtotal ?? row.sub_total ?? 0),
  total: normalizeNumber(row.total ?? row.total_amount ?? row.amount ?? 0),
  amount: normalizeNumber(row.total ?? row.total_amount ?? row.amount ?? 0),
  status: row.status ?? "draft",
  probability: normalizeNumber(row.probability ?? 0),
  notes: row.notes ?? "",
  job_id: normalizeId(row.job_id),
  jobId: normalizeId(row.job_id),
  stage: row.stage ?? "estimating",
  owner_user_id: row.owner_user_id ?? null,
  ownerUserId: row.owner_user_id ?? null,
  due_date: row.due_date ?? null,
  dueDate: row.due_date ?? null,
  review_ready_at: row.review_ready_at ?? null,
  reviewReadyAt: row.review_ready_at ?? null,
  review_approved_at: row.review_approved_at ?? null,
  reviewApprovedAt: row.review_approved_at ?? null,
  converted_job_id: normalizeId(row.converted_job_id),
  convertedJobId: normalizeId(row.converted_job_id),
  converted_at: row.converted_at ?? null,
  convertedAt: row.converted_at ?? null,
});

async function updateWithColumnFallback(
  supabase: any,
  companyId: string,
  id: string | number,
  payload: Record<string, unknown>
) {
  const currentPayload = { ...payload };
  let lastResult: any = null;

  for (let i = 0; i < 20; i += 1) {
    const result = await supabase
      .from("bids")
      .update(currentPayload)
      .eq("company_id", companyId)
      .eq("id", id);
    lastResult = result;
    const message = result.error?.message || "";
    const match = message.match(/Could not find the '([^']+)' column/);
    if (!match) return result;
    const missingColumn = match[1];
    if (!(missingColumn in currentPayload)) return result;
    delete currentPayload[missingColumn];
  }

  return lastResult;
}

async function updateWithVariants(
  supabase: any,
  companyId: string,
  id: string | number,
  payload: Record<string, unknown>
) {
  const variants: Array<Record<string, unknown>> = [payload];

  if ("client" in payload) {
    const withClientName = { ...payload, client_name: payload.client };
    variants.push(withClientName);
  }

  if ("bid_date" in payload) {
    const withBidDateAlias = { ...payload, bidDate: payload.bid_date };
    variants.push(withBidDateAlias);
    if ("client" in payload) {
      variants.push({ ...withBidDateAlias, client_name: payload.client });
    }
  }

  for (const variant of variants) {
    const result = await updateWithColumnFallback(supabase, companyId, id, variant);
    if (!result.error) return result;
    const message = String(result.error.message || "");
    if (!message.includes("Could not find the")) return result;
  }

  return updateWithColumnFallback(supabase, companyId, id, payload);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    try {
      await requireRole(["admin", "pm"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const bidId = normalizeRouteId(id);
    const body = await request.json();

    if (
      body &&
      typeof body === "object" &&
      ("company_id" in body || "created_by" in body || "created_at" in body)
    ) {
      return NextResponse.json(
        { error: "company_id, created_by, and created_at cannot be updated" },
        { status: 400 }
      );
    }

    const parsed = updateBidSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid bid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, companyId, userId } = await getCompanyId();
    const payload = parsed.data;

    const updatePayload: Record<string, unknown> = {};
    if (payload.title !== undefined) {
      updatePayload.title = payload.title;
      updatePayload.project_name = payload.title;
    }
    if (payload.status !== undefined) updatePayload.status = payload.status;
    if (payload.job_id !== undefined) updatePayload.job_id = normalizeId(payload.job_id);
    if (payload.client !== undefined) updatePayload.client = payload.client;
    if (payload.bid_date !== undefined) updatePayload.bid_date = normalizeDate(payload.bid_date);
    if (payload.probability !== undefined) updatePayload.probability = normalizeNumber(payload.probability);
    if (payload.notes !== undefined) updatePayload.notes = payload.notes;
    if (payload.stage !== undefined) updatePayload.stage = payload.stage;
    if (payload.owner_user_id !== undefined) {
      const trimmed = String(payload.owner_user_id ?? "").trim();
      updatePayload.owner_user_id = trimmed || null;
    }
    if (payload.due_date !== undefined) {
      updatePayload.due_date = payload.due_date ? normalizeDate(String(payload.due_date)) : null;
    }
    if (payload.review_ready !== undefined) {
      updatePayload.review_ready_at = payload.review_ready ? new Date().toISOString() : null;
    }
    if (payload.review_approved !== undefined) {
      updatePayload.review_approved_at = payload.review_approved ? new Date().toISOString() : null;
      if (payload.review_approved && updatePayload.stage === undefined) updatePayload.stage = "review";
    }

    if (payload.stage === "won" && payload.status === undefined) {
      updatePayload.status = "accepted";
    }
    if (payload.stage === "lost" && payload.status === undefined) {
      updatePayload.status = "rejected";
    }

    const { data: beforeBid } = await supabase
      .from("bids")
      .select("id, stage, status, review_ready_at, review_approved_at")
      .eq("company_id", companyId)
      .eq("id", bidId)
      .maybeSingle();

    const { error } = await updateWithVariants(supabase, companyId, bidId, updatePayload);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const { data: updatedRow, error: fetchError } = await supabase
      .from("bids")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", bidId)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 400 });
    }

    if (!updatedRow) {
      return NextResponse.json({ error: "Bid not found" }, { status: 404 });
    }

    if (payload.review_approved === true) {
      await logAuditEvent({
        supabase,
        companyId,
        actorUserId: userId,
        eventType: "bid.review_approved",
        entityType: "bid",
        entityId: bidId,
        before: {
          stage: beforeBid?.stage ?? null,
          status: beforeBid?.status ?? null,
          review_approved_at: beforeBid?.review_approved_at ?? null,
        },
        after: {
          stage: updatedRow.stage ?? null,
          status: updatedRow.status ?? null,
          review_approved_at: updatedRow.review_approved_at ?? null,
        },
      });
    }

    return NextResponse.json({ bid: mapBid(updatedRow) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    try {
      await requireRole(["admin"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const bidId = normalizeRouteId(id);
    const { supabase, companyId } = await getCompanyId();

    const { error: itemsError } = await supabase
      .from("bid_items")
      .delete()
      .eq("company_id", companyId)
      .eq("bid_id", bidId);

    if (itemsError && !itemsError.message.toLowerCase().includes("does not exist")) {
      return NextResponse.json({ error: itemsError.message }, { status: 400 });
    }

    const { error } = await supabase
      .from("bids")
      .delete()
      .eq("company_id", companyId)
      .eq("id", bidId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
