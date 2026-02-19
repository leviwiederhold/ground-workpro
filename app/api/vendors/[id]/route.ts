/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";

const vendorStatusSchema = z.enum(["active", "inactive", "preferred", "blocked"]);

const updateVendorSchema = z
  .object({
    name: z.string().min(1).optional(),
    status: vendorStatusSchema.optional(),
    category: z.string().optional(),
    contact_name: z.string().optional(),
    contact: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    rating: z.number().min(0).max(5).optional(),
    active_orders: z.number().nonnegative().optional(),
    activeOrders: z.number().nonnegative().optional(),
    notes: z.string().optional(),
  })
  .refine((value: any) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

const normalizeRouteId = (id: string) => (/^\d+$/.test(id) ? Number(id) : id);

const normalizeNumber = (value: unknown, fallback = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const mapVendor = (row: any) => ({
  id: row.id,
  name: row.name ?? "",
  status: row.status ?? "active",
  category: row.category ?? "",
  contact: row.contact_name ?? row.contact ?? "",
  contact_name: row.contact_name ?? row.contact ?? "",
  phone: row.phone ?? "",
  email: row.email ?? "",
  rating: normalizeNumber(row.rating ?? 0),
  activeOrders: normalizeNumber(row.active_orders ?? row.activeOrders ?? 0),
  active_orders: normalizeNumber(row.active_orders ?? row.activeOrders ?? 0),
  notes: row.notes ?? "",
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
      .from("vendors")
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

    const parsed = updateVendorSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid vendor payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, companyId } = await getCompanyId();
    const payload = parsed.data;

    const updatePayload: Record<string, unknown> = {};
    if (payload.name !== undefined) updatePayload.name = payload.name;
    if (payload.status !== undefined) updatePayload.status = payload.status;
    if (payload.category !== undefined) updatePayload.category = payload.category;
    if (payload.contact_name !== undefined || payload.contact !== undefined) {
      const contactName = payload.contact_name ?? payload.contact ?? "";
      updatePayload.contact_name = contactName;
      updatePayload.contact = payload.contact ?? payload.contact_name ?? contactName;
    }
    if (payload.phone !== undefined) updatePayload.phone = payload.phone;
    if (payload.email !== undefined) updatePayload.email = payload.email;
    if (payload.rating !== undefined) updatePayload.rating = normalizeNumber(payload.rating);
    if (payload.active_orders !== undefined || payload.activeOrders !== undefined) {
      updatePayload.active_orders = normalizeNumber(payload.active_orders ?? payload.activeOrders);
    }
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
      .from("vendors")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", normalizeRouteId(id))
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 400 });
    }

    if (!updatedRow) {
      return NextResponse.json({ error: "Vendor not found" }, { status: 404 });
    }

    return NextResponse.json({ vendor: mapVendor(updatedRow) });
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
      .from("vendors")
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
