/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "zod";
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
    client_name: z.string().optional(),
    customer: z.string().optional(),
    customer_name: z.string().optional(),
    bid_date: z.union([z.string(), z.date(), z.null()]).optional(),
    bidDate: z.union([z.string(), z.date(), z.null()]).optional(),
    biddate: z.union([z.string(), z.date(), z.null()]).optional(),
    probability: z.coerce.number().min(0).max(100).optional(),
    win_probability: z.coerce.number().min(0).max(100).optional(),
    notes: z.string().optional(),
    stage: z.enum(["lead", "qualified", "estimating", "review", "won", "lost"]).optional(),
    owner_user_id: z.string().nullable().optional(),
    due_date: z.union([z.string(), z.date(), z.null()]).nullable().optional(),
    actual_job_cost: z.coerce.number().nonnegative().optional(),
    actualJobCost: z.coerce.number().nonnegative().optional(),
    revenue: z.coerce.number().nonnegative().optional(),
    review_ready: z.boolean().optional(),
    review_approved: z.boolean().optional(),
  })
  .refine((value: any) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

type BidNotesMeta = {
  client?: string;
  bid_date?: string;
  probability?: number;
  stage?: string;
};

const BID_META_PREFIX = "<!--GW_BID_META:";
const BID_META_SUFFIX = "-->";
const BID_META_LEGACY_PREFIX = "\n<!--GW_BID_META:";

function parseBidNotes(raw: unknown): { plainNotes: string; meta: BidNotesMeta } {
  const text = typeof raw === "string" ? raw : "";
  const marker = (() => {
    const normalizedIndex = text.indexOf(BID_META_PREFIX);
    if (normalizedIndex >= 0) return { start: normalizedIndex, length: BID_META_PREFIX.length };
    const legacyIndex = text.indexOf(BID_META_LEGACY_PREFIX);
    if (legacyIndex >= 0) return { start: legacyIndex, length: BID_META_LEGACY_PREFIX.length };
    return null;
  })();
  const start = marker?.start ?? -1;
  if (!marker) {
    return { plainNotes: text, meta: {} };
  }
  const end = text.indexOf(BID_META_SUFFIX, start + marker.length);
  if (start < 0 || end < 0) {
    return { plainNotes: text, meta: {} };
  }
  const plainNotes = text.slice(0, start).trimEnd();
  const jsonText = text.slice(start + marker.length, end).trim();
  try {
    const parsed = JSON.parse(jsonText) as BidNotesMeta;
    return { plainNotes, meta: parsed && typeof parsed === "object" ? parsed : {} };
  } catch {
    return { plainNotes, meta: {} };
  }
}

function buildBidNotes(plainNotes: string, meta: BidNotesMeta): string {
  const compactMeta: BidNotesMeta = {};
  if (meta.client) compactMeta.client = meta.client;
  if (meta.bid_date) compactMeta.bid_date = meta.bid_date;
  if (typeof meta.probability === "number" && !Number.isNaN(meta.probability)) compactMeta.probability = meta.probability;
  if (meta.stage) compactMeta.stage = meta.stage;
  const base = plainNotes?.trimEnd() ?? "";
  if (Object.keys(compactMeta).length === 0) return base;
  const prefix = base.length > 0 ? `\n${BID_META_PREFIX}` : BID_META_PREFIX;
  return `${base}${prefix}${JSON.stringify(compactMeta)}${BID_META_SUFFIX}`;
}

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

const normalizeDate = (value: unknown, fallback: string | null = null) => {
  if (!value) return fallback;
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toISOString().slice(0, 10);
};

const toBidFinancials = (actualJobCost: number, revenue: number) => {
  const normalizedCost = normalizeNumber(actualJobCost);
  const normalizedRevenue = normalizeNumber(revenue);
  const profit = normalizedRevenue - normalizedCost;
  const margin = normalizedRevenue > 0 ? profit / normalizedRevenue : 0;
  return { actualJobCost: normalizedCost, revenue: normalizedRevenue, profit, margin };
};

const pickNonEmptyString = (...values: Array<unknown>) => {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text.length > 0) return text;
  }
  return "";
};

const mapBid = (row: any) => ({
  ...(() => {
    const parsedNotes = parseBidNotes(row.notes);
    const client = pickNonEmptyString(
      row.client,
      row.client_name,
      row.customer,
      row.customer_name,
      parsedNotes.meta.client
    );
    const bidDate = pickNonEmptyString(
      row.bid_date,
      row.bidDate,
      row.biddate,
      parsedNotes.meta.bid_date
    );
    const dbProbability = normalizeNumber(row.probability ?? row.win_probability ?? 0);
    const notesProbability =
      typeof parsedNotes.meta.probability === "number" && !Number.isNaN(parsedNotes.meta.probability)
        ? parsedNotes.meta.probability
        : null;
    const probability = dbProbability === 0 && notesProbability !== null ? notesProbability : dbProbability;
    const revenue = normalizeNumber(row.revenue ?? row.total ?? row.total_amount ?? row.amount ?? 0);
    const actualJobCost = normalizeNumber(row.actual_job_cost ?? row.subtotal ?? row.sub_total ?? 0);
    const profit = normalizeNumber(row.profit, revenue - actualJobCost);
    const margin = normalizeNumber(row.margin, revenue > 0 ? profit / revenue : 0);
    return {
  id: row.id,
  title: row.title ?? row.project_name ?? "",
  projectName: row.title ?? row.project_name ?? "",
  client,
  bid_date: bidDate || null,
  bidDate: bidDate || null,
  subtotal: normalizeNumber(row.subtotal ?? row.sub_total ?? actualJobCost),
  total: revenue,
  amount: revenue,
  actual_job_cost: actualJobCost,
  actualJobCost,
  revenue,
  profit,
  margin,
  status: row.status ?? "draft",
  probability,
  notes: parsedNotes.plainNotes,
  job_id: normalizeId(row.job_id),
  jobId: normalizeId(row.job_id),
  stage: row.stage ?? parsedNotes.meta.stage ?? "estimating",
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
    };
  })(),
});

async function updateWithColumnFallback(
  supabase: any,
  companyId: string,
  id: string | number,
  payload: Record<string, unknown>
) {
  const currentPayload = { ...payload };
  let lastResult: any = null;

  for (let i = 0; i < 8; i += 1) {
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
    const resolvedActualJobCostInput =
      payload.actual_job_cost ?? payload.actualJobCost;
    const resolvedRevenueInput = payload.revenue;
    if (resolvedActualJobCostInput !== undefined) {
      updatePayload.actual_job_cost = normalizeNumber(resolvedActualJobCostInput);
      updatePayload.subtotal = normalizeNumber(resolvedActualJobCostInput);
    }
    if (resolvedRevenueInput !== undefined) {
      const normalizedRevenue = normalizeNumber(resolvedRevenueInput);
      updatePayload.revenue = normalizedRevenue;
      updatePayload.total = normalizedRevenue;
      updatePayload.amount = normalizedRevenue;
      updatePayload.total_amount = normalizedRevenue;
    }
    const resolvedClientInput =
      payload.client ??
      payload.client_name ??
      payload.customer ??
      payload.customer_name;
    if (resolvedClientInput !== undefined) {
      updatePayload.client = resolvedClientInput;
    }
    const resolvedBidDateInput =
      payload.bid_date ??
      payload.bidDate ??
      payload.biddate;
    if (resolvedBidDateInput !== undefined) {
      const normalizedBidDate = normalizeDate(resolvedBidDateInput, null);
      updatePayload.bid_date = normalizedBidDate;
    }
    const resolvedProbabilityInput =
      payload.probability ?? payload.win_probability;
    if (resolvedProbabilityInput !== undefined) {
      const normalizedProbability = normalizeNumber(resolvedProbabilityInput);
      updatePayload.probability = normalizedProbability;
    }
    if (payload.notes !== undefined) updatePayload.notes = payload.notes;
    if (payload.stage !== undefined) updatePayload.stage = payload.stage;
    if (payload.owner_user_id !== undefined) {
      const trimmed = String(payload.owner_user_id ?? "").trim();
      updatePayload.owner_user_id = trimmed || null;
    }
    if (payload.due_date !== undefined) {
      updatePayload.due_date = payload.due_date ? normalizeDate(String(payload.due_date), null) : null;
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
      .select("id, stage, status, review_ready_at, review_approved_at, notes, client, client_name, customer, customer_name, bid_date, bidDate, biddate, probability, win_probability, actual_job_cost, subtotal, revenue, total, total_amount, amount")
      .eq("company_id", companyId)
      .eq("id", bidId)
      .maybeSingle();

    const beforeParsedNotes = parseBidNotes(beforeBid?.notes);
    const resolvedClient =
      resolvedClientInput !== undefined
        ? (resolvedClientInput ?? "")
        : (beforeBid?.client ?? beforeBid?.client_name ?? beforeBid?.customer ?? beforeBid?.customer_name ?? beforeParsedNotes.meta.client ?? "");
    const resolvedBidDate =
      resolvedBidDateInput !== undefined
        ? normalizeDate(resolvedBidDateInput, null)
        : (beforeBid?.bid_date ?? beforeBid?.bidDate ?? beforeBid?.biddate ?? beforeParsedNotes.meta.bid_date ?? null);
    const resolvedProbability =
      resolvedProbabilityInput !== undefined
        ? normalizeNumber(resolvedProbabilityInput)
        : normalizeNumber(beforeBid?.probability ?? beforeBid?.win_probability ?? beforeParsedNotes.meta.probability ?? 0);
    const resolvedStage =
      payload.stage !== undefined
        ? payload.stage
        : (beforeBid?.stage ?? beforeParsedNotes.meta.stage ?? "estimating");
    const plainNotes = payload.notes !== undefined ? (payload.notes ?? "") : beforeParsedNotes.plainNotes;
    updatePayload.notes = buildBidNotes(plainNotes, {
      client: resolvedClient || undefined,
      bid_date: resolvedBidDate || undefined,
      probability: resolvedProbability,
      stage: resolvedStage || undefined,
    });
    const resolvedActualJobCost =
      resolvedActualJobCostInput !== undefined
        ? normalizeNumber(resolvedActualJobCostInput)
        : normalizeNumber(beforeBid?.actual_job_cost ?? beforeBid?.subtotal ?? 0);
    const resolvedRevenue =
      resolvedRevenueInput !== undefined
        ? normalizeNumber(resolvedRevenueInput)
        : normalizeNumber(beforeBid?.revenue ?? beforeBid?.total ?? beforeBid?.total_amount ?? beforeBid?.amount ?? 0);
    const financials = toBidFinancials(resolvedActualJobCost, resolvedRevenue);
    updatePayload.actual_job_cost = financials.actualJobCost;
    updatePayload.revenue = financials.revenue;
    updatePayload.profit = financials.profit;
    updatePayload.margin = financials.margin;
    updatePayload.subtotal = financials.actualJobCost;
    updatePayload.total = financials.revenue;
    updatePayload.amount = financials.revenue;
    updatePayload.total_amount = financials.revenue;

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
