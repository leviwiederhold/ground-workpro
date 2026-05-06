import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireModuleAccess } from "@/lib/auth/requireRole";

const querySchema = z.object({
  q: z.string().trim().optional().default(""),
  status: z.enum(["all", "assigned", "idle", "in_maintenance", "out_of_service"]).optional().default("all"),
  limit: z.coerce.number().int().min(1).max(50).optional().default(25),
});

type DerivedStatus = "ASSIGNED" | "IDLE" | "IN_MAINTENANCE" | "OUT_OF_SERVICE";
type EquipmentNotesMeta = {
  fuelLevel?: number;
  nextService?: number;
  lastUpdate?: string;
  dailyRate?: number;
  purchasePrice?: number;
  purchaseDate?: string;
};

const OPEN_WORK_ORDER_STATUSES = new Set(["open", "in_progress", "in-progress", "scheduled", "pending"]);
const OUT_OF_SERVICE_STATUSES = new Set(["out_of_service", "out-of-service", "down"]);
const OUT_OF_SERVICE_PRIORITIES = new Set(["critical"]);

const toLower = (value: unknown) => String(value ?? "").trim().toLowerCase();

const mapDerivedStatusFilter = (statusFilter: "all" | "assigned" | "idle" | "in_maintenance" | "out_of_service") => {
  if (statusFilter === "all") return null;
  if (statusFilter === "assigned") return "ASSIGNED";
  if (statusFilter === "idle") return "IDLE";
  if (statusFilter === "in_maintenance") return "IN_MAINTENANCE";
  return "OUT_OF_SERVICE";
};

const normalizeId = (value: unknown) => String(value ?? "");
const EQUIPMENT_META_PREFIX = "\n<!--GW_EQUIP_META:";
const EQUIPMENT_META_SUFFIX = "-->";

function parseEquipmentNotes(raw: unknown): EquipmentNotesMeta {
  const text = typeof raw === "string" ? raw : "";
  const start = text.indexOf(EQUIPMENT_META_PREFIX);
  const end = start >= 0 ? text.indexOf(EQUIPMENT_META_SUFFIX, start + EQUIPMENT_META_PREFIX.length) : -1;
  if (start < 0 || end < 0) return {};
  const jsonText = text.slice(start + EQUIPMENT_META_PREFIX.length, end).trim();
  try {
    const parsed = JSON.parse(jsonText) as EquipmentNotesMeta;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
const isMissingSchemaError = (message: string | undefined) =>
  /(column .* does not exist|Could not find the '.*' column|relation .* does not exist|Could not find the table)/i.test(
    message ?? ""
  );

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireModuleAccess("fleet", "view");
    const { supabase, companyId } = await getCompanyId();

    const parsedQuery = querySchema.safeParse({
      q: new URL(request.url).searchParams.get("q") ?? undefined,
      status: new URL(request.url).searchParams.get("status") ?? undefined,
      limit: new URL(request.url).searchParams.get("limit") ?? undefined,
    });

    if (!parsedQuery.success) {
      return NextResponse.json(
        {
          error: "Validation error",
          details: parsedQuery.error.issues.map((issue: { path: Array<string | number>; message: string }) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 422 }
      );
    }

    const { q, status, limit } = parsedQuery.data;
    let equipmentQuery = supabase
      .from("equipment")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (q) {
      const escaped = q.replace(/[%_]/g, "");
      equipmentQuery = equipmentQuery.or(`name.ilike.%${escaped}%,type.ilike.%${escaped}%`);
    }

    let { data: equipmentRows, error: equipmentError } = await equipmentQuery;
    if (equipmentError && isMissingSchemaError(equipmentError.message)) {
      let fallbackEquipmentQuery = supabase
        .from("equipment")
        .select("*")
        .eq("company_id", companyId)
        .order("id", { ascending: false })
        .limit(limit);
      if (q) {
        const escaped = q.replace(/[%_]/g, "");
        fallbackEquipmentQuery = fallbackEquipmentQuery.or(`name.ilike.%${escaped}%,type.ilike.%${escaped}%`);
      }
      const fallbackEquipmentResult = await fallbackEquipmentQuery;
      equipmentRows = fallbackEquipmentResult.data;
      equipmentError = fallbackEquipmentResult.error;
    }
    if (equipmentError) {
      return NextResponse.json({ error: equipmentError.message }, { status: 400 });
    }

    const equipment = equipmentRows ?? [];
    if (equipment.length === 0) {
      return NextResponse.json({ items: [] });
    }

    const equipmentIds = equipment.map((row: Record<string, unknown>) => normalizeId(row.id)).filter(Boolean);
    const today = new Date().toISOString().slice(0, 10);

    const [workOrdersResult, assignmentsResult, jobEquipmentResult] = await Promise.all([
      supabase
        .from("work_orders")
        .select("equipment_id, status, priority")
        .eq("company_id", companyId)
        .in("equipment_id", equipmentIds),
      supabase
        .from("schedule_assignments")
        .select("equipment_id, job_id")
        .eq("company_id", companyId)
        .eq("date", today)
        .in("equipment_id", equipmentIds),
      supabase
        .from("job_equipment")
        .select("equipment_id, job_id")
        .eq("company_id", companyId)
        .in("equipment_id", equipmentIds),
    ]);

    if (workOrdersResult.error && !isMissingSchemaError(workOrdersResult.error.message)) {
      return NextResponse.json({ error: workOrdersResult.error.message }, { status: 400 });
    }
    if (assignmentsResult.error && !isMissingSchemaError(assignmentsResult.error.message)) {
      return NextResponse.json({ error: assignmentsResult.error.message }, { status: 400 });
    }
    if (jobEquipmentResult.error && !isMissingSchemaError(jobEquipmentResult.error.message)) {
      return NextResponse.json({ error: jobEquipmentResult.error.message }, { status: 400 });
    }

    const scheduleAssignmentRows = assignmentsResult.error ? [] : assignmentsResult.data ?? [];
    const jobEquipmentRows = jobEquipmentResult.error ? [] : jobEquipmentResult.data ?? [];
    const assignmentRows =
      scheduleAssignmentRows.length > 0
        ? scheduleAssignmentRows
        : // Fallback when time-grid assignment table is unavailable.
          jobEquipmentRows;
    const assignedJobIds = Array.from(
      new Set(
        assignmentRows
          .map((row: Record<string, unknown>) => row.job_id)
          .filter(Boolean)
          .map(normalizeId)
      )
    );

    let jobNameById = new Map<string, string>();
    if (assignedJobIds.length > 0) {
      const { data: jobs, error: jobsError } = await supabase
        .from("jobs")
        .select("id, name")
        .eq("company_id", companyId)
        .in("id", assignedJobIds);
      if (jobsError) {
        return NextResponse.json({ error: jobsError.message }, { status: 400 });
      }
      jobNameById = new Map(
        (jobs ?? []).map((job: Record<string, unknown>) => [normalizeId(job.id), String(job.name ?? "Job")])
      );
    }

    const assignmentByEquipmentId = new Map<string, Record<string, unknown>>();
    for (const row of assignmentRows as Array<Record<string, unknown>>) {
      const equipmentId = normalizeId(row.equipment_id);
      if (!equipmentId) continue;
      if (!assignmentByEquipmentId.has(equipmentId)) {
        assignmentByEquipmentId.set(equipmentId, row);
      }
    }

    const workOrderAggByEquipmentId = new Map<string, { openCount: number; hasOutOfServiceSignal: boolean; hasMaintenanceSignal: boolean }>();
    for (const row of ((workOrdersResult.error ? [] : workOrdersResult.data) ?? []) as Array<Record<string, unknown>>) {
      const equipmentId = normalizeId(row.equipment_id);
      if (!equipmentId) continue;

      const entry = workOrderAggByEquipmentId.get(equipmentId) ?? {
        openCount: 0,
        hasOutOfServiceSignal: false,
        hasMaintenanceSignal: false,
      };

      const statusValue = toLower(row.status);
      const priorityValue = toLower(row.priority);
      const isOpen = OPEN_WORK_ORDER_STATUSES.has(statusValue);
      if (isOpen) {
        entry.openCount += 1;
        entry.hasMaintenanceSignal = true;
      }
      if (OUT_OF_SERVICE_STATUSES.has(statusValue) || (isOpen && OUT_OF_SERVICE_PRIORITIES.has(priorityValue))) {
        entry.hasOutOfServiceSignal = true;
      }
      workOrderAggByEquipmentId.set(equipmentId, entry);
    }

    const requestedStatus = mapDerivedStatusFilter(status);

    const items = equipment
      .map((row: Record<string, unknown>) => {
        const equipmentId = normalizeId(row.id);
        const assignment = assignmentByEquipmentId.get(equipmentId);
        const workOrderAgg = workOrderAggByEquipmentId.get(equipmentId) ?? {
          openCount: 0,
          hasOutOfServiceSignal: false,
          hasMaintenanceSignal: false,
        };

        const equipmentStatusLower = toLower(row.status);
        const explicitOutOfService = equipmentStatusLower === "out_of_service" || equipmentStatusLower === "out-of-service";
        const inMaintenanceStatus = equipmentStatusLower === "maintenance" || equipmentStatusLower === "in_maintenance" || equipmentStatusLower === "in-maintenance";
        const assignedToday = Boolean(assignment);

        let derivedStatus: DerivedStatus = "IDLE";
        if (explicitOutOfService || workOrderAgg.hasOutOfServiceSignal) {
          derivedStatus = "OUT_OF_SERVICE";
        } else if (inMaintenanceStatus || workOrderAgg.hasMaintenanceSignal) {
          derivedStatus = "IN_MAINTENANCE";
        } else if (assignedToday) {
          derivedStatus = "ASSIGNED";
        }

        const currentJobId = assignment?.job_id ? normalizeId(assignment.job_id) : null;
        const currentJobName = currentJobId ? jobNameById.get(currentJobId) ?? "Job" : null;

        const notesMeta = parseEquipmentNotes(row.notes);
        return {
          id: equipmentId,
          name: String(row.name ?? ""),
          vin: String(row.vin ?? row.vin_number ?? ""),
          typeLabel: String(row.type ?? "Equipment"),
          derivedStatus,
          currentJob: currentJobId
            ? {
                id: currentJobId,
                name: currentJobName,
                href: `/jobs/${currentJobId}`,
              }
            : null,
          assignedToday,
          openWorkOrdersCount: workOrderAgg.openCount,
          status: String(row.status ?? "active"),
          type: String(row.type ?? "Equipment"),
          jobId: row.job_id ?? null,
          hours: Number(row.hours ?? row.hour_meter ?? 0),
          nextService: Number(row.next_service ?? notesMeta.nextService ?? 0),
          fuelLevel: Number(row.fuel_level ?? notesMeta.fuelLevel ?? 0),
          dailyRate: Number(row.daily_rate ?? 0),
          purchasePrice: Number(row.purchase_price ?? notesMeta.purchasePrice ?? 0),
          purchaseDate: String(row.purchase_date ?? notesMeta.purchaseDate ?? ""),
          lastUpdate: String(row.last_update ?? notesMeta.lastUpdate ?? "just now"),
        };
      })
      .filter((item) => (requestedStatus ? item.derivedStatus === requestedStatus : true));

    return NextResponse.json({ items });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
