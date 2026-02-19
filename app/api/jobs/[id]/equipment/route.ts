/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";

const assignEquipmentSchema = z.object({
  equipment_id: z.union([z.number(), z.string()]),
  planned_hours: z.number().nonnegative().optional(),
  notes: z.string().optional(),
});

const normalizeId = (id: unknown): string | number | null => {
  if (id === null || id === undefined || id === "") return null;
  if (typeof id === "number") return id;
  if (typeof id === "string" && /^\d+$/.test(id)) return Number(id);
  if (typeof id === "string") return id;
  return String(id);
};

const isMissingColumnOrTable = (message: string) =>
  /column .* does not exist/i.test(message) ||
  /Could not find the '.*' column/i.test(message) ||
  /relation .* does not exist/i.test(message) ||
  /Could not find the table/i.test(message);

const mapEquipment = (row: any) => ({
  id: row.id,
  name: row.name ?? "",
  type: row.type ?? "Equipment",
  status: row.status ?? "active",
  jobId:
    row.job_id === null || row.job_id === undefined
      ? null
      : typeof row.job_id === "number"
      ? row.job_id
      : Number.isNaN(Number(row.job_id))
      ? row.job_id
      : Number(row.job_id),
  hours: Number(row.hours ?? 0),
  nextService: Number(row.next_service ?? row.nextService ?? 0),
  fuelLevel: Number(row.fuel_level ?? row.fuelLevel ?? 0),
  lat: row.lat === null || row.lat === undefined ? null : Number(row.lat),
  lng: row.lng === null || row.lng === undefined ? null : Number(row.lng),
  lastUpdate: row.last_update ?? row.lastUpdate ?? "just now",
  dailyRate: Number(row.daily_rate ?? row.dailyRate ?? 0),
  purchasePrice: Number(row.purchase_price ?? row.purchasePrice ?? 0),
  purchaseDate: row.purchase_date ?? row.purchaseDate ?? "",
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { supabase, companyId } = await getCompanyId();
    const jobId = normalizeId(id);
    if (jobId === null) {
      return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
    }

    const { data: jobRows, error: jobError } = await supabase
      .from("jobs")
      .select("id")
      .eq("company_id", companyId)
      .eq("id", jobId)
      .limit(1);

    if (jobError || !(jobRows && jobRows.length > 0)) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const assignmentsResult = await supabase
      .from("job_equipment")
      .select("equipment_id")
      .eq("company_id", companyId)
      .eq("job_id", jobId);

    if (assignmentsResult.error) {
      return NextResponse.json({ error: assignmentsResult.error.message }, { status: 400 });
    }

    const assignments = assignmentsResult.data ?? [];
    if (assignments.length === 0) {
      return NextResponse.json({ equipment: [] });
    }

    const ids = assignments
      .map((assignment: any) => normalizeId(assignment.equipment_id))
      .filter((value) => value !== null) as Array<string | number>;

    if (ids.length === 0) {
      return NextResponse.json({ equipment: [] });
    }

    const { data: equipmentRows, error: equipmentError } = await supabase
      .from("equipment")
      .select("*")
      .eq("company_id", companyId)
      .in("id", ids);

    if (equipmentError) {
      return NextResponse.json({ error: equipmentError.message }, { status: 400 });
    }

    return NextResponse.json({ equipment: (equipmentRows ?? []).map(mapEquipment) });
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
    const { id } = await params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (body && typeof body === "object" && "company_id" in body) {
      return NextResponse.json({ error: "company_id cannot be set by client" }, { status: 400 });
    }

    const parsed = assignEquipmentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid assignment payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, companyId } = await getCompanyId();
    const jobId = normalizeId(id);
    const equipmentId = normalizeId(parsed.data.equipment_id);
    if (jobId === null || equipmentId === null) {
      return NextResponse.json({ error: "Invalid job or equipment id" }, { status: 400 });
    }

    const { data: jobRows, error: jobError } = await supabase
      .from("jobs")
      .select("id")
      .eq("company_id", companyId)
      .eq("id", jobId)
      .limit(1);
    if (jobError || !(jobRows && jobRows.length > 0)) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const { data: equipmentRows, error: equipmentError } = await supabase
      .from("equipment")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", equipmentId)
      .limit(1);
    if (equipmentError || !(equipmentRows && equipmentRows.length > 0)) {
      return NextResponse.json({ error: "Equipment not found" }, { status: 404 });
    }

    const insertPayload: Record<string, unknown> = {
      company_id: companyId,
      job_id: jobId,
      equipment_id: equipmentId,
    };
    if (parsed.data.planned_hours !== undefined) insertPayload.planned_hours = parsed.data.planned_hours;
    if (parsed.data.notes !== undefined) insertPayload.notes = parsed.data.notes;

    let result = await supabase.from("job_equipment").insert(insertPayload).select("equipment_id").limit(1);
    if (result.error && isMissingColumnOrTable(result.error.message || "")) {
      return NextResponse.json({ error: result.error.message }, { status: 400 });
    }
    if (result.error) {
      const message = result.error.message || "";
      if (/duplicate key|unique/i.test(message)) {
        return NextResponse.json({ error: "Equipment is already assigned to this job" }, { status: 409 });
      }
      if (/planned_hours/i.test(message)) {
        delete insertPayload.planned_hours;
        result = await supabase.from("job_equipment").insert(insertPayload).select("equipment_id").limit(1);
      } else if (/notes/i.test(message)) {
        delete insertPayload.notes;
        result = await supabase.from("job_equipment").insert(insertPayload).select("equipment_id").limit(1);
      }
    }

    if (result.error) {
      const message = result.error.message || "";
      if (/duplicate key|unique/i.test(message)) {
        return NextResponse.json({ error: "Equipment is already assigned to this job" }, { status: 409 });
      }
      return NextResponse.json({ error: message || "Failed to assign equipment" }, { status: 400 });
    }

    return NextResponse.json({ equipment: mapEquipment(equipmentRows[0]) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
