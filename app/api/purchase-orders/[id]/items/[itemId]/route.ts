/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";

const updatePoItemSchema = z
  .object({
    inventory_id: z.union([z.string(), z.number()]).nullable().optional(),
    description: z.string().optional(),
    quantity: z.number().positive().optional(),
    unit_cost: z.number().nonnegative().optional(),
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

const mapPoItem = (row: any) => ({
  id: row.id,
  purchase_order_id: normalizeId(row.purchase_order_id),
  inventory_id: normalizeId(row.inventory_id),
  description: row.description ?? "",
  quantity: normalizeNumber(row.quantity),
  unit_cost: normalizeNumber(row.unit_cost),
  created_at: row.created_at ?? null,
});

async function updateWithColumnFallback(
  supabase: any,
  companyId: string,
  poId: string | number,
  itemId: string | number,
  payload: Record<string, unknown>
) {
  const currentPayload = { ...payload };
  let lastResult: any = null;

  for (let i = 0; i < 20; i += 1) {
    const result = await supabase
      .from("purchase_order_items")
      .update(currentPayload)
      .eq("company_id", companyId)
      .eq("purchase_order_id", poId)
      .eq("id", itemId);
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
    const poId = normalizeRouteId(id);
    const poItemId = normalizeRouteId(itemId);
    const body = await request.json();

    if (
      body &&
      typeof body === "object" &&
      ("company_id" in body || "purchase_order_id" in body || "created_at" in body)
    ) {
      return NextResponse.json(
        { error: "company_id, purchase_order_id, and created_at cannot be updated" },
        { status: 400 }
      );
    }

    const parsed = updatePoItemSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid purchase order item payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, companyId } = await getCompanyId();
    const payload = parsed.data;

    const updatePayload: Record<string, unknown> = {};
    if (payload.inventory_id !== undefined) updatePayload.inventory_id = normalizeId(payload.inventory_id);
    if (payload.description !== undefined) updatePayload.description = payload.description;
    if (payload.quantity !== undefined) updatePayload.quantity = payload.quantity;
    if (payload.unit_cost !== undefined) updatePayload.unit_cost = payload.unit_cost;

    const { error } = await updateWithColumnFallback(
      supabase,
      companyId,
      poId,
      poItemId,
      updatePayload
    );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const { data: updatedRow, error: fetchError } = await supabase
      .from("purchase_order_items")
      .select("*")
      .eq("company_id", companyId)
      .eq("purchase_order_id", poId)
      .eq("id", poItemId)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 400 });
    }

    if (!updatedRow) {
      return NextResponse.json({ error: "Purchase order item not found" }, { status: 404 });
    }

    return NextResponse.json({ item: mapPoItem(updatedRow) });
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
    const poId = normalizeRouteId(id);
    const poItemId = normalizeRouteId(itemId);
    const { supabase, companyId } = await getCompanyId();

    const { data: deletedRows, error } = await supabase
      .from("purchase_order_items")
      .delete()
      .eq("company_id", companyId)
      .eq("purchase_order_id", poId)
      .eq("id", poItemId)
      .select("id");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (!deletedRows || deletedRows.length === 0) {
      return NextResponse.json({ error: "Purchase order item not found" }, { status: 404 });
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
