/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";

const createPoItemSchema = z.object({
  inventory_id: z.union([z.string(), z.number()]).nullable().optional(),
  description: z.string().default("").optional(),
  quantity: z.number().positive(),
  unit_cost: z.number().nonnegative(),
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

async function verifyPurchaseOrderExists(supabase: any, companyId: string, poId: string | number) {
  const { data, error } = await supabase
    .from("purchase_orders")
    .select("id")
    .eq("company_id", companyId)
    .eq("id", poId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }

  if (!data) {
    return { ok: false, error: "Purchase order not found", status: 404 };
  }

  return { ok: true };
}

async function insertWithColumnFallback(supabase: any, payload: Record<string, unknown>) {
  const currentPayload = { ...payload };
  let lastResult: any = null;

  for (let i = 0; i < 20; i += 1) {
    const result = await supabase
      .from("purchase_order_items")
      .insert(currentPayload)
      .select("*")
      .single();
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
    try {
      await requireRole(["admin", "pm"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const poId = normalizeRouteId(id);
    const { supabase, companyId } = await getCompanyId();

    const verify = await verifyPurchaseOrderExists(supabase, companyId, poId);
    if (!verify.ok) {
      return NextResponse.json({ error: verify.error }, { status: (verify as any).status || 400 });
    }

    let result = await supabase
      .from("purchase_order_items")
      .select("*")
      .eq("company_id", companyId)
      .eq("purchase_order_id", poId)
      .order("created_at", { ascending: false });

    if (result.error?.message?.toLowerCase().includes("created_at")) {
      result = await supabase
        .from("purchase_order_items")
        .select("*")
        .eq("company_id", companyId)
        .eq("purchase_order_id", poId)
        .order("id", { ascending: false });
    }

    const { data, error } = result;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ items: (data ?? []).map(mapPoItem) });
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
    const poId = normalizeRouteId(id);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = createPoItemSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid purchase order item payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, companyId } = await getCompanyId();

    const verify = await verifyPurchaseOrderExists(supabase, companyId, poId);
    if (!verify.ok) {
      return NextResponse.json({ error: verify.error }, { status: (verify as any).status || 400 });
    }

    const payload = parsed.data;

    const basePayload = {
      company_id: companyId,
      purchase_order_id: poId,
      inventory_id: normalizeId(payload.inventory_id),
      description: payload.description ?? "",
      quantity: payload.quantity,
      unit_cost: payload.unit_cost,
    };

    const { data, error } = await insertWithColumnFallback(supabase, basePayload);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ item: mapPoItem(data) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
