/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireModuleAccess } from "@/lib/auth/requireRole";
import { getEffectiveRole } from "@/lib/auth/effectiveRole";
import { getRoleScopedEquipmentIds } from "@/lib/jobs/roleScope";

const equipmentStatusSchema = z.enum(["active", "idle", "maintenance"]);

const updateEquipmentSchema = z
  .object({
    name: z.string().min(1).optional(),
    vin: z.string().trim().max(64).nullable().optional(),
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

type EquipmentNotesMeta = {
  fuelLevel?: number;
  nextService?: number;
  lastUpdate?: string;
  dailyRate?: number;
  purchasePrice?: number;
  purchaseDate?: string;
};

const EQUIPMENT_META_PREFIX = "\n<!--GW_EQUIP_META:";
const EQUIPMENT_META_SUFFIX = "-->";

function parseEquipmentNotes(raw: unknown): { plainNotes: string; meta: EquipmentNotesMeta } {
  const text = typeof raw === "string" ? raw : "";
  const start = text.indexOf(EQUIPMENT_META_PREFIX);
  const end = start >= 0 ? text.indexOf(EQUIPMENT_META_SUFFIX, start + EQUIPMENT_META_PREFIX.length) : -1;
  if (start < 0 || end < 0) {
    return { plainNotes: text, meta: {} };
  }
  const plainNotes = text.slice(0, start).trimEnd();
  const jsonText = text.slice(start + EQUIPMENT_META_PREFIX.length, end).trim();
  try {
    const parsed = JSON.parse(jsonText) as EquipmentNotesMeta;
    return { plainNotes, meta: parsed && typeof parsed === "object" ? parsed : {} };
  } catch {
    return { plainNotes, meta: {} };
  }
}

function buildEquipmentNotes(plainNotes: string, meta: EquipmentNotesMeta): string {
  const compactMeta: EquipmentNotesMeta = {};
  if (Number.isFinite(meta.fuelLevel)) compactMeta.fuelLevel = Number(meta.fuelLevel);
  if (Number.isFinite(meta.nextService)) compactMeta.nextService = Number(meta.nextService);
  if (meta.lastUpdate) compactMeta.lastUpdate = meta.lastUpdate;
  if (Number.isFinite(meta.dailyRate)) compactMeta.dailyRate = Number(meta.dailyRate);
  if (Number.isFinite(meta.purchasePrice)) compactMeta.purchasePrice = Number(meta.purchasePrice);
  if (meta.purchaseDate) compactMeta.purchaseDate = meta.purchaseDate;
  const base = plainNotes?.trimEnd() ?? "";
  if (Object.keys(compactMeta).length === 0) return base;
  return `${base}${EQUIPMENT_META_PREFIX}${JSON.stringify(compactMeta)}${EQUIPMENT_META_SUFFIX}`;
}

const mapEquipment = (row: any) => ({
  id: row.id,
  name: row.name ?? "",
  vin: row.vin ?? row.vin_number ?? "",
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
  hours: Number(row.hours ?? row.hour_meter ?? 0),
  nextService: Number(row.next_service ?? row.nextService ?? parseEquipmentNotes(row.notes).meta.nextService ?? 0),
  fuelLevel: Number(row.fuel_level ?? row.fuelLevel ?? parseEquipmentNotes(row.notes).meta.fuelLevel ?? 0),
  lat: row.lat === null || row.lat === undefined ? null : Number(row.lat),
  lng: row.lng === null || row.lng === undefined ? null : Number(row.lng),
  lastUpdate: row.last_update ?? row.lastUpdate ?? parseEquipmentNotes(row.notes).meta.lastUpdate ?? "just now",
  dailyRate: Number(row.daily_rate ?? row.dailyRate ?? row.hourly_cost ?? parseEquipmentNotes(row.notes).meta.dailyRate ?? 0),
  purchasePrice: Number(row.purchase_price ?? row.purchasePrice ?? parseEquipmentNotes(row.notes).meta.purchasePrice ?? 0),
  purchaseDate: row.purchase_date ?? row.purchaseDate ?? parseEquipmentNotes(row.notes).meta.purchaseDate ?? "",
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
  const parseMissingColumn = (message: string): string | null => {
    const supabaseMatch = message.match(/Could not find the '([^']+)' column/);
    if (supabaseMatch?.[1]) return supabaseMatch[1];
    const genericMatch = message.match(/column "?([a-zA-Z0-9_]+)"? does not exist/i);
    if (genericMatch?.[1]) return genericMatch[1];
    return null;
  };

  for (let i = 0; i < 12; i += 1) {
    const result = await supabase
      .from("equipment")
      .update(currentPayload)
      .eq("company_id", companyId)
      .eq("id", id)
      .select("*");
    lastResult = result;
    const message = result.error?.message || "";
    const missingColumn = parseMissingColumn(message);
    if (!missingColumn) {
      return result;
    }
    if (!(missingColumn in currentPayload)) {
      return result;
    }
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
      await requireModuleAccess("fleet", "view");
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const { supabase, companyId, userId } = await getCompanyId();
    const role = await getEffectiveRole();
    if (!role) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const normalizedId = normalizeId(id);
    const scopedEquipmentIds = await getRoleScopedEquipmentIds(supabase, companyId, userId, role);
    if (scopedEquipmentIds && !scopedEquipmentIds.includes(String(normalizedId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data, error } = await supabase
      .from("equipment")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", normalizedId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (!data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    try {
      await requireModuleAccess("fleet", "edit");
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
    const normalizedId = normalizeId(id);
    const { data: beforeRow } = await supabase
      .from("equipment")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", normalizedId)
      .maybeSingle();
    const beforeNotes = parseEquipmentNotes(beforeRow?.notes);
    const resolvedMeta: EquipmentNotesMeta = {
      fuelLevel:
        payload.fuelLevel !== undefined
          ? payload.fuelLevel
          : beforeNotes.meta.fuelLevel,
      nextService:
        payload.nextService !== undefined
          ? payload.nextService
          : beforeNotes.meta.nextService,
      lastUpdate:
        payload.lastUpdate !== undefined
          ? payload.lastUpdate
          : beforeNotes.meta.lastUpdate,
      dailyRate:
        payload.dailyRate !== undefined
          ? payload.dailyRate
          : beforeNotes.meta.dailyRate,
      purchasePrice:
        payload.purchasePrice !== undefined
          ? payload.purchasePrice
          : beforeNotes.meta.purchasePrice,
      purchaseDate:
        payload.purchaseDate !== undefined
          ? payload.purchaseDate
          : beforeNotes.meta.purchaseDate,
    };

    const updatePayload: Record<string, unknown> = {};
    if (payload.name !== undefined) updatePayload.name = payload.name;
    if (payload.vin !== undefined) {
      const normalizedVin = payload.vin?.trim() || null;
      updatePayload.vin = normalizedVin;
      updatePayload.vin_number = normalizedVin;
    }
    if (payload.type !== undefined) updatePayload.type = payload.type;
    if (payload.status !== undefined) updatePayload.status = payload.status;
    if (payload.hours !== undefined) {
      updatePayload.hours = payload.hours;
      updatePayload.hour_meter = payload.hours;
    }
    if (payload.nextService !== undefined) updatePayload.next_service = payload.nextService;
    if (payload.fuelLevel !== undefined) updatePayload.fuel_level = payload.fuelLevel;
    if (payload.dailyRate !== undefined) updatePayload.daily_rate = payload.dailyRate;
    if (payload.purchasePrice !== undefined) updatePayload.purchase_price = payload.purchasePrice;
    if (payload.purchaseDate !== undefined) updatePayload.purchase_date = payload.purchaseDate;
    if (payload.lastUpdate !== undefined) updatePayload.last_update = payload.lastUpdate;
    if (payload.jobId !== undefined) updatePayload.job_id = normalizeJobId(payload.jobId);
    if (payload.lat !== undefined) updatePayload.lat = payload.lat;
    if (payload.lng !== undefined) updatePayload.lng = payload.lng;

    updatePayload.notes = buildEquipmentNotes(beforeNotes.plainNotes, resolvedMeta);

    const { data, error } = await updateWithColumnFallback(
      supabase,
      companyId,
      normalizedId,
      updatePayload
    );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const updatedRow = Array.isArray(data) ? data[0] : data;
    if (!updatedRow) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ equipment: mapEquipment(updatedRow) });
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
      await requireModuleAccess("fleet", "edit");
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
