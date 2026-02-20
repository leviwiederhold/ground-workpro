/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { calcBid } from "@/lib/pricing/calcBid";
import { requireRole } from "@/lib/auth/requireRole";

const bidItemTypeSchema = z.enum(["custom", "labor", "equipment", "material", "subcontract"]);

const createBidItemSchema = z.object({
  item_type: bidItemTypeSchema.default("custom").optional(),
  description: z.string().min(1),
  quantity: z.number().positive(),
  unit_cost: z.number().nonnegative(),
  equipment_id: z.union([z.string(), z.number()]).optional(),
});

const normalizeRouteId = (id: string) => (/^\d+$/.test(id) ? Number(id) : id);
const normalizeId = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return value;
};
const normalizeNumber = (value: unknown, fallback = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const mapBidItem = (row: any) => ({
  id: row.id,
  bid_id: row.bid_id,
  item_type: row.item_type ?? "custom",
  equipment_id: normalizeId(row.equipment_id ?? row.equipmentId),
  description: row.description ?? "",
  quantity: normalizeNumber(row.quantity),
  unit_cost: normalizeNumber(row.unit_cost),
  total_cost: normalizeNumber(row.total_cost),
  created_at: row.created_at ?? null,
});

async function verifyBidExists(supabase: any, companyId: string, bidId: string | number) {
  const { data, error } = await supabase
    .from("bids")
    .select("id")
    .eq("company_id", companyId)
    .eq("id", bidId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Bid not found", status: 404 };
  return { ok: true };
}

async function recalcBidTotal(supabase: any, companyId: string, bidId: string | number) {
  let itemsResult = await supabase
    .from("bid_items")
    .select("*")
    .eq("company_id", companyId)
    .eq("bid_id", bidId);

  if (itemsResult.error?.message?.toLowerCase().includes("company_id")) {
    itemsResult = await supabase
      .from("bid_items")
      .select("*")
      .eq("bid_id", bidId);
  }

  if (itemsResult.error?.message?.toLowerCase().includes("bid_id")) {
    itemsResult = await supabase
      .from("bid_items")
      .select("*")
      .eq("bidId", bidId);
    if (!itemsResult.error) return finalizeRecalcBidTotal(supabase, companyId, bidId, itemsResult.data ?? []);

    if (itemsResult.error?.message?.toLowerCase().includes("company_id")) {
      itemsResult = await supabase
        .from("bid_items")
        .select("*")
        .eq("bidId", bidId);
    }
  }

  if (itemsResult.error) return { ok: false, error: itemsResult.error.message };
  return finalizeRecalcBidTotal(supabase, companyId, bidId, itemsResult.data ?? []);
}

async function finalizeRecalcBidTotal(
  supabase: any,
  companyId: string,
  bidId: string | number,
  items: any[]
) {
  const { data: pricingSettings, error: pricingError } = await supabase
    .from("pricing_settings")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();

  if (pricingError && !pricingError.message.toLowerCase().includes("does not exist")) {
    return { ok: false, error: pricingError.message };
  }

  const summary = calcBid(pricingSettings ?? null, items);
  const updatePayload: Record<string, unknown> = {
    subtotal: summary.subtotalCost,
    total: summary.revenue,
    amount: summary.revenue,
    total_amount: summary.revenue,
  };

  let lastResult: any = null;
  for (let i = 0; i < 20; i += 1) {
    const result = await supabase
      .from("bids")
      .update(updatePayload)
      .eq("company_id", companyId)
      .eq("id", bidId);
    lastResult = result;

    const message = result.error?.message || "";
    const match = message.match(/Could not find the '([^']+)' column/);
    if (!match) break;
    const missingColumn = match[1];
    if (!(missingColumn in updatePayload)) break;
    delete updatePayload[missingColumn];
    if (Object.keys(updatePayload).length === 0) return { ok: true };
  }

  if (lastResult?.error) return { ok: false, error: lastResult.error.message };
  return { ok: true };
}

async function insertWithColumnFallback(supabase: any, payload: Record<string, unknown>) {
  const currentPayload = { ...payload };
  let lastResult: any = null;

  for (let i = 0; i < 20; i += 1) {
    const result = await supabase.from("bid_items").insert(currentPayload).select("*").single();
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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const bidId = normalizeRouteId(id);
    const { supabase, companyId } = await getCompanyId();

    const verify = await verifyBidExists(supabase, companyId, bidId);
    if (!verify.ok) {
      return NextResponse.json({ error: verify.error }, { status: (verify as any).status || 400 });
    }

    let usesBidId = false;
    let usesCompanyFilter = true;
    let result = await supabase
      .from("bid_items")
      .select("*")
      .eq("company_id", companyId)
      .eq("bid_id", bidId)
      .order("created_at", { ascending: false });

    if (result.error?.message?.toLowerCase().includes("company_id")) {
      usesCompanyFilter = false;
      result = await supabase
        .from("bid_items")
        .select("*")
        .eq("bid_id", bidId)
        .order("created_at", { ascending: false });
    }

    if (result.error?.message?.toLowerCase().includes("bid_id")) {
      usesBidId = true;
      if (usesCompanyFilter) {
        result = await supabase
          .from("bid_items")
          .select("*")
          .eq("company_id", companyId)
          .eq("bidId", bidId)
          .order("created_at", { ascending: false });
      } else {
        result = await supabase
          .from("bid_items")
          .select("*")
          .eq("bidId", bidId)
          .order("created_at", { ascending: false });
      }
    }

    if (result.error?.message?.toLowerCase().includes("created_at")) {
      if (usesCompanyFilter) {
        result = await supabase
          .from("bid_items")
          .select("*")
          .eq("company_id", companyId)
          .eq(usesBidId ? "bidId" : "bid_id", bidId)
          .order("id", { ascending: false });
      } else {
        result = await supabase
          .from("bid_items")
          .select("*")
          .eq(usesBidId ? "bidId" : "bid_id", bidId)
          .order("id", { ascending: false });
      }
    }

    const { data, error } = result;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ items: (data ?? []).map(mapBidItem) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
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

    const { id } = await params;
    const bidId = normalizeRouteId(id);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = createBidItemSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid bid item payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, companyId } = await getCompanyId();

    const verify = await verifyBidExists(supabase, companyId, bidId);
    if (!verify.ok) {
      return NextResponse.json({ error: verify.error }, { status: (verify as any).status || 400 });
    }

    const payload = parsed.data;
    const quantity = normalizeNumber(payload.quantity);
    const unitCost = normalizeNumber(payload.unit_cost);
    const totalCost = quantity * unitCost;

    const basePayload = {
      company_id: companyId,
      bid_id: bidId,
      item_type: payload.item_type ?? "custom",
      equipment_id: normalizeId(payload.equipment_id),
      description: payload.description,
      quantity,
      unit_cost: unitCost,
      total_cost: totalCost,
    };

    const { data, error } = await insertWithColumnFallback(supabase, basePayload);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const recalc = await recalcBidTotal(supabase, companyId, bidId);
    if (!recalc.ok) {
      return NextResponse.json({ error: recalc.error }, { status: 400 });
    }

    return NextResponse.json({ item: mapBidItem(data) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
