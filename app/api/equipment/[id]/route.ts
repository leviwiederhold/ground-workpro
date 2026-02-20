/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";

const equipmentStatusSchema = z.enum(["active", "idle", "maintenance"]);

const updateEquipmentSchema = z
  .object({
    name: z.string().min(1).optional(),
    type: z.string().optional(),
    status: equipmentStatusSchema.optional(),
    hours: z.number().nonnegative().optional(),
    nextService: z.number().nonnegative().optional(),
    fuelLevel: z.number().min(0).max(100).optional(),
    dailyRate: z.number().nonnegative().optional(),
    purchasePrice: z.number().nonnegative().optional(),
    purchaseDate: z.string().optional(),
    lastUpdate: z.string().optional(),
    jobId: z.union([z.number(), z.string()]).nullable().optional(),
    lat: z.number().nullable().optional(),
    lng: z.number().nullable().optional(),
  })
  .refine((value: any) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

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

const normalizeId = (id: string) => (/^\d+$/.test(id) ? Number(id) : id);
const normalizeJobId = (jobId: unknown) => {
  if (jobId === null || jobId === undefined || jobId === "") return null;
  if (typeof jobId === "number") return jobId;
  if (typeof jobId === "string" && /^\d+$/.test(jobId)) return Number(jobId);
  return jobId;
};

async function updateWithColumnFallback(
  supabase: any,
  companyId: string,
  id: string | number,
  payload: Record<string, unknown>
) {
  const currentPayload = { ...payload };
  let lastResult: any = null;

  for (let i = 0; i < 12; i += 1) {
    const result = await supabase
      .from("equipment")
      .update(currentPayload)
      .eq("company_id", companyId)
      .eq("id", id)
      .select("*")
      .single();
    lastResult = result;
    const message = result.error?.message || "";
    const match = message.match(/Could not find the '([^']+)' column/);
    if (!match) {
      return result;
    }
    const missingColumn = match[1];
    if (!(missingColumn in currentPayload)) {
      return result;
    }
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
    const parsed = updateEquipmentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid equipment payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, companyId } = await getCompanyId();
    const payload = parsed.data;

    const updatePayload: Record<string, unknown> = {};
    if (payload.name !== undefined) updatePayload.name = payload.name;
    if (payload.type !== undefined) updatePayload.type = payload.type;
    if (payload.status !== undefined) updatePayload.status = payload.status;
    if (payload.hours !== undefined) updatePayload.hours = payload.hours;
    if (payload.nextService !== undefined) updatePayload.next_service = payload.nextService;
    if (payload.fuelLevel !== undefined) updatePayload.fuel_level = payload.fuelLevel;
    if (payload.dailyRate !== undefined) updatePayload.daily_rate = payload.dailyRate;
    if (payload.purchasePrice !== undefined) updatePayload.purchase_price = payload.purchasePrice;
    if (payload.purchaseDate !== undefined) updatePayload.purchase_date = payload.purchaseDate;
    if (payload.lastUpdate !== undefined) updatePayload.last_update = payload.lastUpdate;
    if (payload.jobId !== undefined) updatePayload.job_id = normalizeJobId(payload.jobId);
    if (payload.lat !== undefined) updatePayload.lat = payload.lat;
    if (payload.lng !== undefined) updatePayload.lng = payload.lng;

    const { data, error } = await updateWithColumnFallback(
      supabase,
      companyId,
      normalizeId(id),
      updatePayload
    );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ equipment: mapEquipment(data) });
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
      await requireRole(["admin", "pm", "mechanic"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const { supabase, companyId } = await getCompanyId();

    const { error } = await supabase
      .from("equipment")
      .delete()
      .eq("company_id", companyId)
      .eq("id", normalizeId(id));

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
