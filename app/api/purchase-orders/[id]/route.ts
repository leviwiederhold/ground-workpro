/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";

const poStatusSchema = z.enum(["draft", "submitted", "approved", "ordered", "received", "canceled"]);

const updatePurchaseOrderSchema = z
  .object({
    vendor_id: z.union([z.string(), z.number()]).optional(),
    job_id: z.union([z.string(), z.number()]).nullable().optional(),
    status: poStatusSchema.optional(),
    notes: z.string().optional(),
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

const mapPurchaseOrder = (row: any) => ({
  id: row.id,
  vendor_id: normalizeId(row.vendor_id),
  job_id: normalizeId(row.job_id),
  status: row.status ?? "draft",
  notes: row.notes ?? "",
  created_at: row.created_at ?? null,
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
      .from("purchase_orders")
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

    const parsed = updatePurchaseOrderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid purchase order payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, companyId } = await getCompanyId();
    const payload = parsed.data;

    const updatePayload: Record<string, unknown> = {};
    if (payload.vendor_id !== undefined) updatePayload.vendor_id = normalizeId(payload.vendor_id);
    if (payload.job_id !== undefined) updatePayload.job_id = normalizeId(payload.job_id);
    if (payload.status !== undefined) updatePayload.status = payload.status;
    if (payload.notes !== undefined) updatePayload.notes = payload.notes;

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
      .from("purchase_orders")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", normalizeRouteId(id))
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 400 });
    }

    if (!updatedRow) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    }

    return NextResponse.json({ purchase_order: mapPurchaseOrder(updatedRow) });
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
    const poId = normalizeRouteId(id);
    const { supabase, companyId } = await getCompanyId();

    const { error: itemsError } = await supabase
      .from("purchase_order_items")
      .delete()
      .eq("company_id", companyId)
      .eq("purchase_order_id", poId);

    if (itemsError && !itemsError.message.toLowerCase().includes("does not exist")) {
      return NextResponse.json({ error: itemsError.message }, { status: 400 });
    }

    const { error } = await supabase
      .from("purchase_orders")
      .delete()
      .eq("company_id", companyId)
      .eq("id", poId);

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
