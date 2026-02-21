/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { getPaginationFromUrl, getPaginationMeta } from "@/lib/http/pagination";

const workOrderTypeSchema = z.enum(["repair", "preventive", "inspection"]);
const workOrderPrioritySchema = z.enum(["low", "medium", "high"]);
const workOrderStatusSchema = z.enum(["scheduled", "in-progress", "completed"]);

const createWorkOrderSchema = z.object({
  equipmentId: z.union([z.number(), z.string()]),
  type: workOrderTypeSchema.default("repair").optional(),
  priority: workOrderPrioritySchema.default("medium").optional(),
  status: workOrderStatusSchema.default("scheduled").optional(),
  title: z.string().min(1),
  description: z.string().default("").optional(),
  assignedTo: z.union([z.number(), z.string()]).nullable().optional(),
  dueDate: z.string().default("").optional(),
  laborHours: z.number().nonnegative().default(0).optional(),
});

const normalizeId = (id: unknown) => {
  if (id === null || id === undefined || id === "") return null;
  if (typeof id === "number") return id;
  if (typeof id === "string" && /^\d+$/.test(id)) return Number(id);
  return id;
};

const normalizeUuid = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return null;
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidPattern.test(value) ? value : null;
};

const toDbStatus = (status: string | undefined) => {
  if (!status) return status;
  if (status === "in-progress") return "in_progress";
  return status;
};

const toUiStatus = (status: string | undefined) => {
  if (!status) return "scheduled";
  if (status === "in_progress") return "in-progress";
  return status;
};

const mapWorkOrder = (row: any) => ({
  id: row.id,
  equipmentId: normalizeId(row.equipment_id ?? row.equipmentId),
  type: row.type ?? "repair",
  priority: row.priority ?? "medium",
  status: toUiStatus(row.status),
  title: row.title ?? "",
  description: row.description ?? "",
  assignedTo: normalizeId(row.assigned_to ?? row.assignedTo),
  createdAt: row.created_at ?? row.createdAt ?? "",
  dueDate: row.due_date ?? row.dueDate ?? "",
  parts: row.parts ?? [],
  laborHours: Number(row.labor_hours ?? row.laborHours ?? 0),
});

async function insertWithColumnFallback(supabase: any, payload: Record<string, unknown>) {
  const currentPayload = { ...payload };
  let lastResult: any = null;

  for (let i = 0; i < 16; i += 1) {
    const result = await supabase.from("work_orders").insert(currentPayload).select("*").single();
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
    const { data, error, count } = await supabase
      .from("work_orders")
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const workOrders = (data ?? []).map(mapWorkOrder);
    return NextResponse.json({ workOrders, ...getPaginationMeta(count ?? workOrders.length, page, pageSize) });
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

    const parsed = createWorkOrderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid work order payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, companyId } = await getCompanyId();
    const payload = parsed.data;
    const now = new Date().toISOString().slice(0, 10);

    const { data: userData } = await supabase.auth.getUser();
    const basePayload = {
      company_id: companyId,
      created_by: userData?.user?.id ?? null,
      equipment_id: normalizeId(payload.equipmentId),
      type: payload.type ?? "repair",
      priority: payload.priority ?? "medium",
      title: payload.title,
      description: payload.description ?? "",
      assigned_to: normalizeUuid(payload.assignedTo),
      due_date: payload.dueDate ? payload.dueDate : null,
      created_at: now,
      parts: [],
      labor_hours: payload.laborHours ?? 0,
    };

    let result = await insertWithColumnFallback(supabase, {
      ...basePayload,
      ...(payload.status ? { status: toDbStatus(payload.status) } : {}),
    });

    if (result.error?.message?.includes("work_orders_status_check") && payload.status) {
      result = await insertWithColumnFallback(supabase, basePayload);
    }

    if (result.error?.message?.includes("work_orders_priority_check") && payload.priority) {
      const noPriority: Record<string, unknown> = { ...basePayload };
      delete noPriority.priority;
      result = await insertWithColumnFallback(supabase, noPriority);
    }

    if (result.error?.message?.includes("created_by")) {
      const noCreatedBy: Record<string, unknown> = { ...basePayload };
      delete noCreatedBy.created_by;
      result = await insertWithColumnFallback(supabase, noCreatedBy);
    }

    const { data, error } = result;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ workOrder: mapWorkOrder(data) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
