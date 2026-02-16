/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";

const equipmentStatusSchema = z.enum(["active", "idle", "maintenance"]);

const createEquipmentSchema = z.object({
  name: z.string().min(1),
  type: z.string().default("Equipment").optional(),
  status: equipmentStatusSchema.default("active").optional(),
  hours: z.number().nonnegative().default(0).optional(),
  nextService: z.number().nonnegative().default(0).optional(),
  fuelLevel: z.number().min(0).max(100).default(100).optional(),
  dailyRate: z.number().nonnegative().default(0).optional(),
  purchasePrice: z.number().nonnegative().default(0).optional(),
  purchaseDate: z.string().default("").optional(),
  lastUpdate: z.string().default("just now").optional(),
  jobId: z.union([z.number(), z.string()]).nullable().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
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

const normalizeJobId = (jobId: unknown) => {
  if (jobId === null || jobId === undefined || jobId === "") return null;
  if (typeof jobId === "number") return jobId;
  if (typeof jobId === "string" && /^\d+$/.test(jobId)) return Number(jobId);
  return jobId;
};

async function insertWithColumnFallback(supabase: any, payload: Record<string, unknown>) {
  const currentPayload = { ...payload };
  let lastResult: any = null;

  for (let i = 0; i < 12; i += 1) {
    const result = await supabase.from("equipment").insert(currentPayload).select("*").single();
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

export async function GET() {
  try {
    const { supabase, companyId } = await getCompanyId();
    const { data, error } = await supabase
      .from("equipment")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ equipment: (data ?? []).map(mapEquipment) });
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
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = createEquipmentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid equipment payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, companyId } = await getCompanyId();
    const payload = parsed.data;

    const basePayload = {
      company_id: companyId,
      name: payload.name,
      type: payload.type ?? "Equipment",
      hours: payload.hours ?? 0,
      next_service: payload.nextService ?? 0,
      fuel_level: payload.fuelLevel ?? 100,
      daily_rate: payload.dailyRate ?? 0,
      purchase_price: payload.purchasePrice ?? 0,
      purchase_date: payload.purchaseDate ?? "",
      last_update: payload.lastUpdate ?? "just now",
      job_id: normalizeJobId(payload.jobId),
      lat: payload.lat ?? null,
      lng: payload.lng ?? null,
    };

    let result = await insertWithColumnFallback(supabase, {
      ...basePayload,
      ...(payload.status ? { status: payload.status } : {}),
    });

    if (result.error?.message?.includes("status") && payload.status) {
      result = await insertWithColumnFallback(supabase, basePayload);
    }

    const { data, error } = result;
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
