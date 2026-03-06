/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { getPaginationFromUrl, getPaginationMeta } from "@/lib/http/pagination";
import { getRoleScopedEquipmentIds, resolveMembershipRole } from "@/lib/jobs/roleScope";

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

const normalizeJobId = (jobId: unknown) => {
  if (jobId === null || jobId === undefined || jobId === "") return null;
  if (typeof jobId === "number") return jobId;
  if (typeof jobId === "string" && /^\d+$/.test(jobId)) return Number(jobId);
  return jobId;
};

async function insertWithColumnFallback(supabase: any, payload: Record<string, unknown>) {
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
    const result = await supabase.from("equipment").insert(currentPayload).select("*").single();
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

export async function GET(request: Request) {
  try {
    const { page, pageSize, from, to } = getPaginationFromUrl(request.url, { defaultPageSize: 50, maxPageSize: 200 });
    const { supabase, companyId, userId } = await getCompanyId();
    const role = await resolveMembershipRole(supabase, companyId, userId);
    if (!role) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const scopedEquipmentIds = await getRoleScopedEquipmentIds(supabase, companyId, userId, role);
    if (scopedEquipmentIds && scopedEquipmentIds.length === 0) {
      const pagination = getPaginationMeta(0, page, pageSize);
      return NextResponse.json({ equipment: [], items: [], ...pagination });
    }

    let query = supabase
      .from("equipment")
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (scopedEquipmentIds) {
      query = query.in("id", scopedEquipmentIds);
    }

    const { data, error, count } = await query.range(from, to);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const equipment = (data ?? []).map(mapEquipment);
    return NextResponse.json({ equipment, items: equipment, ...getPaginationMeta(count ?? equipment.length, page, pageSize) });
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

    const parsed = createEquipmentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid equipment payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, companyId } = await getCompanyId();
    const payload = parsed.data;

    const notes = buildEquipmentNotes("", {
      fuelLevel: payload.fuelLevel ?? 100,
      nextService: payload.nextService ?? 0,
      lastUpdate: payload.lastUpdate ?? "just now",
      dailyRate: payload.dailyRate ?? 0,
      purchasePrice: payload.purchasePrice ?? 0,
      purchaseDate: payload.purchaseDate ?? "",
    });

    const basePayload = {
      company_id: companyId,
      name: payload.name,
      type: payload.type ?? "Equipment",
      hours: payload.hours ?? 0,
      hour_meter: payload.hours ?? 0,
      next_service: payload.nextService ?? 0,
      fuel_level: payload.fuelLevel ?? 100,
      daily_rate: payload.dailyRate ?? 0,
      hourly_cost: payload.dailyRate ?? 0,
      purchase_price: payload.purchasePrice ?? 0,
      purchase_date: payload.purchaseDate ?? "",
      last_update: payload.lastUpdate ?? "just now",
      job_id: normalizeJobId(payload.jobId),
      lat: payload.lat ?? null,
      lng: payload.lng ?? null,
      notes,
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

    const mapped = mapEquipment(data);
    return NextResponse.json({ equipment: mapped, item: mapped });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
