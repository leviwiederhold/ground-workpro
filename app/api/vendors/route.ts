/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { getPaginationFromUrl, getPaginationMeta } from "@/lib/http/pagination";

const vendorStatusSchema = z.enum(["active", "preferred", "on_hold", "inactive", "blocked"]);
const VENDOR_STATUS_TAG_REGEX = /__gw_vendor_status:(preferred|on_hold|blocked)__/i;
const VENDOR_META_TAG_REGEX = /^__gw_vendor_meta:([^\n]+)__\n?/i;

const createVendorSchema = z.object({
  name: z.string().min(1),
  status: vendorStatusSchema.default("active").optional(),
  category: z.string().default("").optional(),
  contact_name: z.string().default("").optional(),
  contact: z.string().default("").optional(),
  phone: z.string().default("").optional(),
  email: z.string().default("").optional(),
  address: z.string().default("").optional(),
  payment_terms: z.string().default("").optional(),
  rating: z.coerce.number().default(0).optional(),
  active_orders: z.coerce.number().default(0).optional(),
  activeOrders: z.coerce.number().default(0).optional(),
  notes: z.string().default("").optional(),
});

const normalizeNumber = (value: unknown, fallback = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const normalizeStatusForDb = (value: unknown) => {
  if (!value) return undefined;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return undefined;
  return raw.replace(/[\s-]+/g, "_");
};

const getStatusFallbacks = (value: unknown) => {
  const normalized = normalizeStatusForDb(value);
  if (!normalized) return [];
  const candidates = [normalized];
  if (normalized === "preferred") candidates.push("active");
  if (normalized === "on_hold" || normalized === "blocked") candidates.push("inactive");
  if (!candidates.includes("active")) candidates.push("active");
  return candidates;
};

const parseVendorMeta = (notes: unknown) => {
  const text = String(notes ?? "");
  const line = text.match(VENDOR_META_TAG_REGEX)?.[1];
  if (!line) return {};
  const params = new URLSearchParams(line);
  return {
    category: params.get("category") ?? "",
    payment_terms: params.get("payment_terms") ?? "",
    rating: params.get("rating"),
    active_orders: params.get("active_orders"),
  };
};

const stripSystemTags = (notes: unknown) =>
  String(notes ?? "")
    .replace(VENDOR_STATUS_TAG_REGEX, "")
    .replace(VENDOR_META_TAG_REGEX, "")
    .trimStart();

const getDisplayStatus = (row: any) => {
  const tagged = String(row.notes ?? "").match(VENDOR_STATUS_TAG_REGEX)?.[1];
  if (tagged) return tagged;
  const normalized = normalizeStatusForDb(row.status) ?? "active";
  if (normalized === "inactive") return "inactive";
  return normalized;
};

const buildSystemNotes = (
  notes: unknown,
  displayStatus: string,
  meta: { category?: string; payment_terms?: string; rating?: number; active_orders?: number }
) => {
  const cleanNotes = stripSystemTags(notes);
  const metaParams = new URLSearchParams();
  metaParams.set("category", String(meta.category ?? ""));
  metaParams.set("payment_terms", String(meta.payment_terms ?? ""));
  metaParams.set("rating", String(meta.rating ?? 0));
  metaParams.set("active_orders", String(meta.active_orders ?? 0));
  const lines = [`__gw_vendor_meta:${metaParams.toString()}__`];
  if (displayStatus === "preferred" || displayStatus === "on_hold" || displayStatus === "blocked") {
    lines.push(`__gw_vendor_status:${displayStatus}__`);
  }
  if (cleanNotes) lines.push(cleanNotes);
  return lines.join("\n").trimEnd();
};

const toDbStatus = (displayStatus: string) => {
  if (displayStatus === "preferred") return "active";
  if (displayStatus === "on_hold" || displayStatus === "blocked") return "inactive";
  return displayStatus;
};

const normalizeRating = (value: unknown) => {
  const normalized = normalizeNumber(value, 0);
  const fiveScale = normalized > 5 ? normalized / 20 : normalized;
  return Math.max(0, Math.min(5, fiveScale));
};

const normalizeCount = (value: unknown) => {
  const normalized = normalizeNumber(value, 0);
  return Math.max(0, Math.floor(normalized));
};

const mapVendor = (row: any) => ({
  ...(() => {
    const meta = parseVendorMeta(row.notes ?? "");
    const metaRating = normalizeNumber(meta.rating, 0);
    const metaActiveOrders = normalizeNumber(meta.active_orders, 0);
    return {
  id: row.id,
  name: row.name ?? "",
  status: getDisplayStatus(row),
  category: row.category ?? meta.category ?? "",
  contact: row.contact_name ?? row.contact ?? "",
  contact_name: row.contact_name ?? row.contact ?? "",
  phone: row.phone ?? "",
  email: row.email ?? "",
  address: row.address ?? "",
  payment_terms: row.payment_terms ?? row.paymentTerms ?? meta.payment_terms ?? "",
  rating: metaRating || normalizeNumber(row.rating ?? 0),
  activeOrders: metaActiveOrders || normalizeNumber(row.active_orders ?? row.activeOrders ?? 0),
  active_orders: metaActiveOrders || normalizeNumber(row.active_orders ?? row.activeOrders ?? 0),
  notes: stripSystemTags(row.notes ?? ""),
    };
  })(),
});

async function insertWithColumnFallback(supabase: any, payload: Record<string, unknown>) {
  const currentPayload = { ...payload };
  let lastResult: any = null;

  for (let i = 0; i < 20; i += 1) {
    const result = await supabase.from("vendors").insert(currentPayload).select("*").single();
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
    try {
      await requireRole(["admin", "pm", "foreman", "mechanic", "operator"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { page, pageSize, from, to } = getPaginationFromUrl(request.url, { defaultPageSize: 50, maxPageSize: 200 });
    const { supabase, companyId } = await getCompanyId();
    let result = await supabase
      .from("vendors")
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (result.error?.message?.toLowerCase().includes("created_at")) {
      result = await supabase
        .from("vendors")
        .select("*", { count: "exact" })
        .eq("company_id", companyId)
        .order("id", { ascending: false })
        .range(from, to);
    }

    const { data, error, count } = result;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const vendors = (data ?? []).map(mapVendor);
    return NextResponse.json({
      items: vendors,
      vendors,
      ...getPaginationMeta(count ?? vendors.length, page, pageSize),
    });
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

    const parsed = createVendorSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid vendor payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, companyId, userId } = await getCompanyId();
    const payload = parsed.data;

    const displayStatus = normalizeStatusForDb(payload.status ?? "active") ?? "active";
    const ratingInput = Math.max(0, Math.min(100, normalizeNumber(payload.rating ?? 0, 0)));
    const activeOrdersInput = normalizeCount(payload.active_orders ?? payload.activeOrders ?? 0);
    const notesWithTags = buildSystemNotes(payload.notes ?? "", displayStatus, {
      category: payload.category ?? "",
      payment_terms: payload.payment_terms ?? "",
      rating: ratingInput,
      active_orders: activeOrdersInput,
    });
    const basePayload = {
      company_id: companyId,
      created_by: userId,
      name: payload.name,
      category: payload.category ?? "",
      contact_name: payload.contact_name ?? payload.contact ?? "",
      contact: payload.contact ?? payload.contact_name ?? "",
      phone: payload.phone ?? "",
      email: payload.email ?? "",
      address: payload.address ?? "",
      payment_terms: payload.payment_terms ?? "",
      rating: normalizeRating(ratingInput),
      active_orders: activeOrdersInput,
      notes: notesWithTags,
    };

    const statusCandidates = getStatusFallbacks(toDbStatus(displayStatus));
    let result: any = null;
    if (statusCandidates.length > 0) {
      for (const statusCandidate of statusCandidates) {
        result = await insertWithColumnFallback(supabase, {
          ...basePayload,
          status: statusCandidate,
        });
        if (!result.error) break;
        if (!result.error?.message?.includes("vendors_status_check")) break;
      }
    } else {
      result = await insertWithColumnFallback(supabase, basePayload);
    }

    if (result?.error?.message?.toLowerCase().includes("status")) {
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

    const mappedVendor = mapVendor(data);
    return NextResponse.json({ item: mappedVendor, vendor: mappedVendor });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
