/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { getPaginationFromUrl, getPaginationMeta } from "@/lib/http/pagination";

const inventoryStatusSchema = z.enum(["active", "low_stock", "out_of_stock", "inactive"]);

const createInventorySchema = z.object({
  name: z.string().min(1),
  category: z.string().default("Materials").optional(),
  unit: z.string().default("EA").optional(),
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
  location: z.string().default("").optional(),
  status: inventoryStatusSchema.default("active").optional(),
});

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

async function insertWithColumnFallback(supabase: any, payload: Record<string, unknown>) {
  const currentPayload = { ...payload };
  let lastResult: any = null;

  for (let i = 0; i < 20; i += 1) {
    const result = await supabase.from("inventory").insert(currentPayload).select("*").single();
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
    const { page, pageSize, from, to } = getPaginationFromUrl(request.url, { defaultPageSize: 50, maxPageSize: 200 });
    const { supabase, companyId } = await getCompanyId();
    let result = await supabase
      .from("inventory")
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (result.error?.message?.toLowerCase().includes("created_at")) {
      result = await supabase
        .from("inventory")
        .select("*", { count: "exact" })
        .eq("company_id", companyId)
        .order("id", { ascending: false })
        .range(from, to);
    }

    const { data, error, count } = result;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const inventory = (data ?? []).map(mapInventory);
    return NextResponse.json({ inventory, ...getPaginationMeta(count ?? inventory.length, page, pageSize) });
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
      await requireRole(["admin", "pm", "mechanic"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = createInventorySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid inventory payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, companyId, userId } = await getCompanyId();
    const payload = parsed.data;

    const basePayload = {
      company_id: companyId,
      created_by: userId,
      name: payload.name,
      category: payload.category ?? "Materials",
      unit: payload.unit ?? "EA",
      qty_on_hand: normalizeNumber(payload.quantity_on_hand ?? payload.qtyOnHand ?? payload.qty_on_hand),
      qty_reserved: normalizeNumber(payload.qtyReserved ?? payload.qty_reserved),
      reorder_point: normalizeNumber(payload.reorderPoint ?? payload.reorder_point),
      unit_cost: normalizeNumber(payload.unitCost ?? payload.unit_cost),
      job_id: normalizeId(payload.jobId ?? payload.job_id),
      location: payload.location ?? "",
    };

    let result = await insertWithColumnFallback(supabase, {
      ...basePayload,
      ...(payload.status ? { status: payload.status } : {}),
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

    return NextResponse.json({ item: mapInventory(data) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
