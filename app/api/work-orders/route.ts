/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { getPaginationFromUrl, getPaginationMeta } from "@/lib/http/pagination";
import { getRoleScopedEquipmentIds } from "@/lib/jobs/roleScope";
import { enqueueNotifications } from "@/lib/notifications/enqueue";
import { getEffectiveRole } from "@/lib/auth/effectiveRole";

const workOrderTypeSchema = z.enum(["repair", "preventive", "inspection"]);
const workOrderPrioritySchema = z.enum(["low", "medium", "high"]);
const workOrderStatusSchema = z.enum([
  "open",
  "scheduled",
  "in-progress",
  "in_progress",
  "waiting_parts",
  "completed",
  "closed",
]);

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
  const normalized = String(status).toLowerCase().trim();
  if (normalized === "in-progress") return "in_progress";
  if (["complete", "done", "closed", "resolved"].includes(normalized)) return "completed";
  return normalized;
};

const toUiStatus = (status: string | undefined) => {
  if (!status) return "scheduled";
  if (status === "in_progress") return "in-progress";
  if (status === "open") return "scheduled";
  if (status === "scheduled") return "scheduled";
  if (status === "in-progress") return "in-progress";
  if (status === "waiting_parts") return "scheduled";
  if (status === "closed") return "completed";
  if (status === "completed") return "completed";
  if (status === "complete") return "completed";
  if (status === "done") return "completed";
  if (status === "resolved") return "completed";
  return status;
};

const statusCandidates = (status: string | undefined) => {
  if (!status) return [];
  const raw = String(status).toLowerCase().trim();
  if (["in-progress", "in_progress", "inprogress"].includes(raw)) {
    return ["in_progress", "in-progress", "inprogress"];
  }
  if (["completed", "complete", "done", "closed", "resolved"].includes(raw)) {
    return ["completed", "closed", "complete", "done", "resolved"];
  }
  if (["scheduled", "open", "pending"].includes(raw)) {
    return ["open", "scheduled", "pending"];
  }
  if (raw === "waiting_parts") return ["waiting_parts"];
  const normalized = String(toDbStatus(status) || raw).toLowerCase();
  return [normalized];
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

  for (let i = 0; i < 8; i += 1) {
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
    const { supabase, companyId, userId } = await getCompanyId();
    const role = await getEffectiveRole();

    if (!role || role === "operator") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const scopedEquipmentIds = role === "foreman"
      ? await getRoleScopedEquipmentIds(supabase, companyId, userId, role)
      : null;

    if (scopedEquipmentIds && scopedEquipmentIds.length === 0) {
      const pagination = getPaginationMeta(0, page, pageSize);
      return NextResponse.json({ workOrders: [], items: [], ...pagination });
    }

    let query = supabase
      .from("work_orders")
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (scopedEquipmentIds) {
      query = query.in("equipment_id", scopedEquipmentIds);
    }

    const { data, error, count } = await query.range(from, to);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const workOrders = (data ?? []).map(mapWorkOrder);
    return NextResponse.json({ workOrders, items: workOrders, ...getPaginationMeta(count ?? workOrders.length, page, pageSize) });
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
    const effectiveRole = await getEffectiveRole();
    const createAllowed =
      effectiveRole === "admin" ||
      effectiveRole === "mechanic" ||
      effectiveRole === "foreman" ||
      effectiveRole === "operator";
    if (!createAllowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let actor: Awaited<ReturnType<typeof requireRole>>;
    try {
      actor = await requireRole(["admin", "foreman", "mechanic", "operator"]);
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
    const isFieldRequester = actor.role === "operator" || actor.role === "foreman";

    const { data: userData } = await supabase.auth.getUser();
    const basePayload = {
      company_id: companyId,
      created_by: userData?.user?.id ?? null,
      equipment_id: normalizeId(payload.equipmentId),
      type: isFieldRequester ? "repair" : (payload.type ?? "repair"),
      priority: payload.priority ?? "medium",
      title: payload.title,
      description: payload.description ?? "",
      assigned_to: isFieldRequester ? null : normalizeUuid(payload.assignedTo),
      due_date: payload.dueDate ? payload.dueDate : null,
      created_at: now,
      parts: [],
      labor_hours: payload.laborHours ?? 0,
    };

    let result = await insertWithColumnFallback(supabase, {
      ...basePayload,
      ...(isFieldRequester ? { status: toDbStatus("scheduled") } : payload.status ? { status: toDbStatus(payload.status) } : {}),
    });

    if (result.error?.message?.includes("work_orders_status_check") && payload.status) {
      const variants = statusCandidates(payload.status);
      for (const variant of variants) {
        result = await insertWithColumnFallback(supabase, { ...basePayload, status: variant });
        if (!result.error) break;
      }
      if (result.error) {
        result = await insertWithColumnFallback(supabase, basePayload);
      }
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

    try {
      const recipientsResult = await supabase
        .from("memberships")
        .select("user_id, role")
        .eq("company_id", companyId)
        .in("role", ["admin", "pm", "mechanic"]);

      if (!recipientsResult.error) {
        const recipientUserIds = (recipientsResult.data ?? [])
          .map((row: { user_id: string | null }) => String(row.user_id ?? ""))
          .filter(Boolean);

        await enqueueNotifications({
          supabase,
          companyId,
          userIds: recipientUserIds,
          type: "work_order_reported",
          payload: {
            workOrderId: String(data.id),
            title: String(data.title ?? payload.title),
            date: now,
            reportedByRole: actor.role,
            href: "/maintenance",
          },
        });
      }
    } catch {
      // Do not block work order creation if notifications fail.
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
