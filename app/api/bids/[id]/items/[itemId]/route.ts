/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { calcBid } from "@/lib/pricing/calcBid";
import { requireRole } from "@/lib/auth/requireRole";

const bidItemTypeSchema = z.enum(["custom", "labor", "equipment", "material", "subcontract"]);

const updateBidItemSchema = z
  .object({
    item_type: bidItemTypeSchema.optional(),
    equipment_id: z.union([z.string(), z.number()]).nullable().optional(),
    description: z.string().min(1).optional(),
    quantity: z.number().positive().optional(),
    unit_cost: z.number().nonnegative().optional(),
  })
  .refine((value: any) => Object.keys(value).length > 0, {
    message: "At least one field is required",
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
    if (itemsResult.error?.message?.toLowerCase().includes("company_id")) {
      itemsResult = await supabase
        .from("bid_items")
        .select("*")
        .eq("bidId", bidId);
    }
  }

  if (itemsResult.error) return { ok: false, error: itemsResult.error.message };

  const { data: pricingSettings, error: pricingError } = await supabase
    .from("pricing_settings")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();

  if (pricingError && !pricingError.message.toLowerCase().includes("does not exist")) {
    return { ok: false, error: pricingError.message };
  }

  const summary = calcBid(pricingSettings ?? null, itemsResult.data ?? []);
  const revenue = summary.revenue;
  const actualJobCost = summary.subtotalCost;
  const updatePayload: Record<string, unknown> = {
    subtotal: actualJobCost,
    total: revenue,
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

async function updateWithColumnFallback(
  supabase: any,
  companyId: string,
  bidId: string | number,
  itemId: string | number,
  payload: Record<string, unknown>
) {
  const currentPayload = { ...payload };
  let lastResult: any = null;
  let useBidIdColumn = false;
  let useCompanyFilter = true;

  for (let i = 0; i < 20; i += 1) {
    let query = supabase
      .from("bid_items")
      .update(currentPayload)
      .eq(useBidIdColumn ? "bidId" : "bid_id", bidId)
      .eq("id", itemId);
    if (useCompanyFilter) {
      query = query.eq("company_id", companyId);
    }
    const result = await query;
    lastResult = result;
    const message = result.error?.message || "";
    if (message.toLowerCase().includes("company_id") && useCompanyFilter) {
      useCompanyFilter = false;
      continue;
    }
    if (message.toLowerCase().includes("bid_id") && !useBidIdColumn) {
      useBidIdColumn = true;
      continue;
    }
    const match = message.match(/Could not find the '([^']+)' column/);
    if (!match) return result;
    const missingColumn = match[1];
    if (!(missingColumn in currentPayload)) return result;
    delete currentPayload[missingColumn];
  }

  return lastResult;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    try {
      await requireRole(["admin", "pm"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id, itemId } = await params;
    const bidId = normalizeRouteId(id);
    const rowId = normalizeRouteId(itemId);
    const body = await request.json();

    const parsed = updateBidItemSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid bid item payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, companyId } = await getCompanyId();
    const payload = parsed.data;

    let existingRowResult = await supabase
      .from("bid_items")
      .select("*")
      .eq("company_id", companyId)
      .eq("bid_id", bidId)
      .eq("id", rowId)
      .maybeSingle();

    if (existingRowResult.error?.message?.toLowerCase().includes("company_id")) {
      existingRowResult = await supabase
        .from("bid_items")
        .select("*")
        .eq("bid_id", bidId)
        .eq("id", rowId)
        .maybeSingle();
    }

    if (existingRowResult.error?.message?.toLowerCase().includes("bid_id")) {
      existingRowResult = await supabase
        .from("bid_items")
        .select("*")
        .eq("bidId", bidId)
        .eq("id", rowId)
        .maybeSingle();
    }

    const { data: existingRow, error: existingError } = existingRowResult;

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 400 });
    }

    if (!existingRow) {
      return NextResponse.json({ error: "Bid item not found" }, { status: 404 });
    }

    const nextQuantity = payload.quantity !== undefined ? normalizeNumber(payload.quantity) : normalizeNumber(existingRow.quantity);
    const nextUnitCost = payload.unit_cost !== undefined ? normalizeNumber(payload.unit_cost) : normalizeNumber(existingRow.unit_cost);

    const updatePayload: Record<string, unknown> = {
      total_cost: nextQuantity * nextUnitCost,
    };

    if (payload.item_type !== undefined) updatePayload.item_type = payload.item_type;
    if (payload.equipment_id !== undefined) updatePayload.equipment_id = normalizeId(payload.equipment_id);
    if (payload.description !== undefined) updatePayload.description = payload.description;
    if (payload.quantity !== undefined) updatePayload.quantity = nextQuantity;
    if (payload.unit_cost !== undefined) updatePayload.unit_cost = nextUnitCost;

    const { error } = await updateWithColumnFallback(supabase, companyId, bidId, rowId, updatePayload);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    let updatedRowResult = await supabase
      .from("bid_items")
      .select("*")
      .eq("company_id", companyId)
      .eq("bid_id", bidId)
      .eq("id", rowId)
      .maybeSingle();

    if (updatedRowResult.error?.message?.toLowerCase().includes("company_id")) {
      updatedRowResult = await supabase
        .from("bid_items")
        .select("*")
        .eq("bid_id", bidId)
        .eq("id", rowId)
        .maybeSingle();
    }

    if (updatedRowResult.error?.message?.toLowerCase().includes("bid_id")) {
      updatedRowResult = await supabase
        .from("bid_items")
        .select("*")
        .eq("bidId", bidId)
        .eq("id", rowId)
        .maybeSingle();
    }

    const { data: updatedRow, error: fetchError } = updatedRowResult;

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 400 });
    }

    if (!updatedRow) {
      return NextResponse.json({ error: "Bid item not found" }, { status: 404 });
    }

    const recalc = await recalcBidTotal(supabase, companyId, bidId);
    if (!recalc.ok) {
      return NextResponse.json({ error: recalc.error }, { status: 400 });
    }

    return NextResponse.json({ item: mapBidItem(updatedRow) });
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
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    try {
      await requireRole(["admin", "pm"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id, itemId } = await params;
    const bidId = normalizeRouteId(id);
    const rowId = normalizeRouteId(itemId);
    const { supabase, companyId } = await getCompanyId();

    let deletedResult = await supabase
      .from("bid_items")
      .delete()
      .eq("company_id", companyId)
      .eq("bid_id", bidId)
      .eq("id", rowId)
      .select("id");

    if (deletedResult.error?.message?.toLowerCase().includes("company_id")) {
      deletedResult = await supabase
        .from("bid_items")
        .delete()
        .eq("bid_id", bidId)
        .eq("id", rowId)
        .select("id");
    }

    if (deletedResult.error?.message?.toLowerCase().includes("bid_id")) {
      deletedResult = await supabase
        .from("bid_items")
        .delete()
        .eq("bidId", bidId)
        .eq("id", rowId)
        .select("id");
    }

    const { data: deletedRows, error } = deletedResult;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (!deletedRows || deletedRows.length === 0) {
      return NextResponse.json({ error: "Bid item not found" }, { status: 404 });
    }

    const recalc = await recalcBidTotal(supabase, companyId, bidId);
    if (!recalc.ok) {
      return NextResponse.json({ error: recalc.error }, { status: 400 });
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
