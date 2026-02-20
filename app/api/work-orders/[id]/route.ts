/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";

const workOrderTypeSchema = z.enum(["repair", "preventive", "inspection"]);
const workOrderPrioritySchema = z.enum(["low", "medium", "high"]);
const workOrderStatusSchema = z.enum(["scheduled", "in-progress", "completed"]);

const updateWorkOrderSchema = z
  .object({
    equipmentId: z.union([z.number(), z.string()]).nullable().optional(),
    type: workOrderTypeSchema.optional(),
    priority: workOrderPrioritySchema.optional(),
    status: workOrderStatusSchema.optional(),
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    assignedTo: z.union([z.number(), z.string()]).nullable().optional(),
    dueDate: z.string().optional(),
    laborHours: z.number().nonnegative().optional(),
  })
  .refine((value: any) => Object.keys(value).length > 0, {
    message: "At least one field is required",
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

const normalizeRouteId = (id: string) => (/^\d+$/.test(id) ? Number(id) : id);

async function updateWithColumnFallback(
  supabase: any,
  companyId: string,
  id: string | number,
  payload: Record<string, unknown>
) {
  const currentPayload = { ...payload };
  let lastResult: any = null;

  for (let i = 0; i < 16; i += 1) {
    const result = await supabase
      .from("work_orders")
      .update(currentPayload)
      .eq("company_id", companyId)
      .eq("id", id)
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    try {
      await requireRole(["admin", "pm", "mechanic"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const parsed = updateWorkOrderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid work order payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, companyId } = await getCompanyId();
    const payload = parsed.data;

    const updatePayload: Record<string, unknown> = {};
    if (payload.equipmentId !== undefined) updatePayload.equipment_id = normalizeId(payload.equipmentId);
    if (payload.type !== undefined) updatePayload.type = payload.type;
    if (payload.priority !== undefined) updatePayload.priority = payload.priority;
    if (payload.status !== undefined) updatePayload.status = toDbStatus(payload.status);
    if (payload.title !== undefined) updatePayload.title = payload.title;
    if (payload.description !== undefined) updatePayload.description = payload.description;
    if (payload.assignedTo !== undefined) updatePayload.assigned_to = normalizeUuid(payload.assignedTo);
    if (payload.dueDate !== undefined) updatePayload.due_date = payload.dueDate ? payload.dueDate : null;
    if (payload.laborHours !== undefined) updatePayload.labor_hours = payload.laborHours;

    const { data, error } = await updateWithColumnFallback(
      supabase,
      companyId,
      normalizeRouteId(id),
      updatePayload
    );

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

export async function DELETE(
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
    const { supabase, companyId } = await getCompanyId();

    const { error } = await supabase
      .from("work_orders")
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
