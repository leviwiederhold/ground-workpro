/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { getPaginationFromUrl, getPaginationMeta } from "@/lib/http/pagination";

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

const createBidSchema = z.object({
  title: z.string().min(1),
  status: bidStatusSchema.default("draft").optional(),
  job_id: z.union([z.string(), z.number()]).nullable().optional(),
  client: z.string().default("").optional(),
  bid_date: z.string().optional().nullable(),
  probability: z.number().min(0).max(100).default(0).optional(),
  notes: z.string().default("").optional(),
  stage: z.enum(["lead", "qualified", "estimating", "review", "won", "lost"]).default("estimating").optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
  due_date: z.string().optional().nullable(),
  actual_job_cost: z.number().nonnegative().optional(),
  revenue: z.number().nonnegative().optional(),
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

const statusFromStage = (stage: string | undefined) => {
  if (!stage) return undefined;
  if (stage === "won") return "accepted";
  if (stage === "lost") return "rejected";
  if (stage === "review") return "pending";
  return "draft";
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
    const revenue = normalizeNumber(row.total ?? row.total_amount ?? row.amount ?? row.revenue ?? 0);
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

async function insertWithColumnFallback(supabase: any, payload: Record<string, unknown>) {
  const currentPayload = { ...payload };
  let lastResult: any = null;

  for (let i = 0; i < 8; i += 1) {
    const result = await supabase.from("bids").insert(currentPayload).select("*").single();
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

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const stage = (url.searchParams.get("stage") || "").trim().toLowerCase();
    const ownerUserId = (url.searchParams.get("owner_user_id") || "").trim();
    const reviewReady = (url.searchParams.get("review_ready") || "").trim().toLowerCase();

    const { page, pageSize, from, to } = getPaginationFromUrl(request.url, { defaultPageSize: 50, maxPageSize: 200 });
    const { supabase, companyId } = await getCompanyId();
    let query = supabase
      .from("bids")
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (["lead", "qualified", "estimating", "review", "won", "lost"].includes(stage)) {
      query = query.eq("stage", stage);
    }
    if (ownerUserId) {
      query = query.eq("owner_user_id", ownerUserId);
    }
    if (reviewReady === "true") {
      query = query.not("review_ready_at", "is", null);
    } else if (reviewReady === "false") {
      query = query.is("review_ready_at", null);
    }

    let result = await query.range(from, to);

    if (result.error?.message?.toLowerCase().includes("created_at")) {
      result = await supabase
        .from("bids")
        .select("*", { count: "exact" })
        .eq("company_id", companyId)
        .order("id", { ascending: false })
        .range(from, to);
    }

    const { data, error, count } = result;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const bids = (data ?? []).map(mapBid);
    return NextResponse.json({ bids, ...getPaginationMeta(count ?? bids.length, page, pageSize) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    try {
      await requireRole(["admin", "pm"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = createBidSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid bid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, companyId, userId } = await getCompanyId();
    const payload = parsed.data;

    const normalizedBidDate = normalizeDate(payload.bid_date, null);
    const normalizedProbability = normalizeNumber(payload.probability ?? 0);
    const financials = toBidFinancials(
      payload.actual_job_cost ?? 0,
      payload.revenue ?? 0
    );

    const notesWithMeta = buildBidNotes(payload.notes ?? "", {
      client: payload.client ?? "",
      bid_date: normalizedBidDate ?? undefined,
      probability: normalizedProbability,
      stage: payload.stage ?? "estimating",
    });

    const basePayload = {
      company_id: companyId,
      created_by: userId,
      title: payload.title,
      client: payload.client ?? "",
      bid_date: normalizedBidDate,
      probability: normalizedProbability,
      notes: notesWithMeta,
      job_id: normalizeId(payload.job_id),
      actual_job_cost: financials.actualJobCost,
      profit: financials.profit,
      margin: financials.margin,
      subtotal: financials.actualJobCost,
      total: financials.revenue,
      amount: financials.revenue,
      total_amount: financials.revenue,
      stage: payload.stage ?? "estimating",
      owner_user_id: payload.owner_user_id ?? userId,
      due_date: payload.due_date ?? null,
    };

    let result = await insertWithColumnFallback(supabase, {
      ...basePayload,
      ...(payload.status ? { status: payload.status } : statusFromStage(payload.stage) ? { status: statusFromStage(payload.stage) } : {}),
    });

    if (result.error?.message?.toLowerCase().includes("status") && payload.status) {
      result = await insertWithColumnFallback(supabase, basePayload);
    }

    if (result.error?.message?.toLowerCase().includes("created_by")) {
      const withoutCreatedBy: Record<string, unknown> = { ...basePayload };
      delete withoutCreatedBy.created_by;
      result = await insertWithColumnFallback(supabase, withoutCreatedBy);
    }

    const { data, error } = result;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ bid: mapBid(data) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
