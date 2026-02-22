/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getPaginationFromUrl, getPaginationMeta } from "@/lib/http/pagination";
import { enqueueOutboxEvent } from "@/lib/outbox/queue";
import { requireRole } from "@/lib/auth/requireRole";

const poStatusSchema = z.enum(["draft", "submitted", "approved", "ordered", "received", "canceled"]);

const createPurchaseOrderSchema = z.object({
  vendor_id: z.union([z.string(), z.number()]),
  job_id: z.union([z.string(), z.number()]).nullable().optional(),
  status: poStatusSchema.default("draft").optional(),
  notes: z.string().default("").optional(),
});

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

async function insertWithColumnFallback(supabase: any, payload: Record<string, unknown>) {
  const currentPayload = { ...payload };
  let lastResult: any = null;

  for (let i = 0; i < 20; i += 1) {
    const result = await supabase
      .from("purchase_orders")
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

export async function GET(request: Request) {
  try {
    try {
      await requireRole(["admin", "pm"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { page, pageSize, from, to } = getPaginationFromUrl(request.url, { defaultPageSize: 50, maxPageSize: 200 });
    const { supabase, companyId } = await getCompanyId();
    let result = await supabase
      .from("purchase_orders")
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (result.error?.message?.toLowerCase().includes("created_at")) {
      result = await supabase
        .from("purchase_orders")
        .select("*", { count: "exact" })
        .eq("company_id", companyId)
        .order("id", { ascending: false })
        .range(from, to);
    }

    const { data, error, count } = result;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const purchase_orders = (data ?? []).map(mapPurchaseOrder);
    return NextResponse.json({ purchase_orders, ...getPaginationMeta(count ?? purchase_orders.length, page, pageSize) });
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

    const parsed = createPurchaseOrderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid purchase order payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, companyId, userId } = await getCompanyId();
    const payload = parsed.data;

    const basePayload = {
      company_id: companyId,
      created_by: userId,
      vendor_id: normalizeId(payload.vendor_id),
      job_id: normalizeId(payload.job_id),
      notes: payload.notes ?? "",
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

    await enqueueOutboxEvent(supabase, {
      companyId,
      eventType: "purchase_order.created",
      aggregateType: "purchase_order",
      aggregateId: String(data.id),
      idempotencyKey: `purchase_order.created:${data.id}`,
      payload: {
        purchase_order_id: data.id,
        vendor_id: normalizeId(data.vendor_id),
        job_id: normalizeId(data.job_id),
        status: data.status ?? "draft",
      },
    });

    return NextResponse.json({ purchase_order: mapPurchaseOrder(data) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
