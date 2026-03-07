/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
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
  bid_date: z.string().optional(),
  probability: z.number().min(0).max(100).default(0).optional(),
  notes: z.string().default("").optional(),
  stage: z.enum(["lead", "qualified", "estimating", "review", "won", "lost"]).default("estimating").optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
  due_date: z.string().optional().nullable(),
});

type BidNotesMeta = {
  client?: string;
  bid_date?: string;
  probability?: number;
};

const BID_META_PREFIX = "\n<!--GW_BID_META:";
const BID_META_SUFFIX = "-->";

function parseBidNotes(raw: unknown): { plainNotes: string; meta: BidNotesMeta } {
  const text = typeof raw === "string" ? raw : "";
  const start = text.indexOf(BID_META_PREFIX);
  const end = start >= 0 ? text.indexOf(BID_META_SUFFIX, start + BID_META_PREFIX.length) : -1;
  if (start < 0 || end < 0) {
    return { plainNotes: text, meta: {} };
  }
  const plainNotes = text.slice(0, start).trimEnd();
  const jsonText = text.slice(start + BID_META_PREFIX.length, end).trim();
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
  const base = plainNotes?.trimEnd() ?? "";
  if (Object.keys(compactMeta).length === 0) return base;
  return `${base}${BID_META_PREFIX}${JSON.stringify(compactMeta)}${BID_META_SUFFIX}`;
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
  if (!value || typeof value !== "string") return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toISOString().slice(0, 10);
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
    return {
  id: row.id,
  title: row.title ?? row.project_name ?? "",
  projectName: row.title ?? row.project_name ?? "",
  client: row.client ?? row.client_name ?? row.customer ?? row.customer_name ?? parsedNotes.meta.client ?? "",
  bid_date: row.bid_date ?? row.bidDate ?? row.biddate ?? parsedNotes.meta.bid_date ?? null,
  bidDate: row.bid_date ?? row.bidDate ?? row.biddate ?? parsedNotes.meta.bid_date ?? null,
  subtotal: normalizeNumber(row.subtotal ?? row.sub_total ?? 0),
  total: normalizeNumber(row.total ?? row.total_amount ?? row.amount ?? 0),
  amount: normalizeNumber(row.total ?? row.total_amount ?? row.amount ?? 0),
  status: row.status ?? "draft",
  probability: normalizeNumber(row.probability ?? row.win_probability ?? parsedNotes.meta.probability ?? 0),
  notes: parsedNotes.plainNotes,
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
    };
  })(),
});

async function insertWithColumnFallback(supabase: any, payload: Record<string, unknown>) {
  const currentPayload = { ...payload };
  let lastResult: any = null;

  for (let i = 0; i < 20; i += 1) {
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

    const notesWithMeta = buildBidNotes(payload.notes ?? "", {
      client: payload.client ?? "",
      bid_date: normalizedBidDate ?? undefined,
      probability: normalizedProbability,
    });

    const basePayload = {
      company_id: companyId,
      created_by: userId,
      title: payload.title,
      project_name: payload.title,
      client: payload.client ?? "",
      client_name: payload.client ?? "",
      customer: payload.client ?? "",
      customer_name: payload.client ?? "",
      bid_date: normalizedBidDate,
      bidDate: normalizedBidDate,
      biddate: normalizedBidDate,
      amount: 0,
      total_amount: 0,
      probability: normalizedProbability,
      win_probability: normalizedProbability,
      notes: notesWithMeta,
      job_id: normalizeId(payload.job_id),
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
