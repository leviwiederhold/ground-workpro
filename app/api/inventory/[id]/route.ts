/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";

const inventoryStatusSchema = z.enum(["active", "low_stock", "out_of_stock", "inactive"]);

const updateInventorySchema = z
  .object({
    name: z.string().min(1).optional(),
    category: z.string().optional(),
    unit: z.string().optional(),
    quantity_on_hand: z.number().optional(),
    qtyOnHand: z.number().optional(),
    qty_on_hand: z.number().optional(),
    qtyReserved: z.number().optional(),
    qty_reserved: z.number().optional(),
    reorderPoint: z.number().optional(),
    reorder_point: z.number().optional(),
    unitCost: z.number().optional(),
    unit_cost: z.number().optional(),
    jobId: z.union([z.number(), z.string()]).nullable().optional(),
    job_id: z.union([z.number(), z.string()]).nullable().optional(),
    location: z.string().optional(),
    status: inventoryStatusSchema.optional(),
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

const mapInventory = (row: any) => ({
  id: row.id,
  name: row.name ?? "",
  category: row.category ?? "Materials",
  unit: row.unit ?? "EA",
  qtyOnHand: normalizeNumber(row.qty_on_hand ?? row.qtyOnHand),
  qtyReserved: normalizeNumber(row.qty_reserved ?? row.qtyReserved),
  reorderPoint: normalizeNumber(row.reorder_point ?? row.reorderPoint),
  unitCost: normalizeNumber(row.unit_cost ?? row.unitCost),
  jobId: normalizeId(row.job_id ?? row.jobId),
  location: row.location ?? "",
  status: row.status ?? "active",
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
      .from("inventory")
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    const parsed = updateInventorySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid inventory payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, companyId } = await getCompanyId();
    const payload = parsed.data;

    const updatePayload: Record<string, unknown> = {};
    if (payload.name !== undefined) updatePayload.name = payload.name;
    if (payload.category !== undefined) updatePayload.category = payload.category;
    if (payload.unit !== undefined) updatePayload.unit = payload.unit;
    if (payload.quantity_on_hand !== undefined || payload.qtyOnHand !== undefined || payload.qty_on_hand !== undefined) {
      updatePayload.qty_on_hand = normalizeNumber(
        payload.quantity_on_hand ?? payload.qtyOnHand ?? payload.qty_on_hand
      );
    }
    if (payload.qtyReserved !== undefined || payload.qty_reserved !== undefined) {
      updatePayload.qty_reserved = normalizeNumber(payload.qtyReserved ?? payload.qty_reserved);
    }
    if (payload.reorderPoint !== undefined || payload.reorder_point !== undefined) {
      updatePayload.reorder_point = normalizeNumber(payload.reorderPoint ?? payload.reorder_point);
    }
    if (payload.unitCost !== undefined || payload.unit_cost !== undefined) {
      updatePayload.unit_cost = normalizeNumber(payload.unitCost ?? payload.unit_cost);
    }
    if (payload.jobId !== undefined || payload.job_id !== undefined) {
      updatePayload.job_id = normalizeId(payload.jobId ?? payload.job_id);
    }
    if (payload.location !== undefined) updatePayload.location = payload.location;
    if (payload.status !== undefined) updatePayload.status = payload.status;

    const { error } = await updateWithColumnFallback(
      supabase,
      companyId,
      normalizeRouteId(id),
      updatePayload
    );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const { data: updatedRow, error: fetchError } = await supabase
      .from("inventory")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", normalizeRouteId(id))
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 400 });
    }

    if (!updatedRow) {
      return NextResponse.json({ error: "Inventory item not found" }, { status: 404 });
    }

    return NextResponse.json({ item: mapInventory(updatedRow) });
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
    const { id } = await params;
    const { supabase, companyId } = await getCompanyId();

    const { error } = await supabase
      .from("inventory")
      .delete()
      .eq("company_id", companyId)
      .eq("id", normalizeRouteId(id));

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
