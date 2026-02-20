/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";

const materialSchema = z.object({
  item: z.string().default(""),
  qty: z.union([z.number(), z.string()]).default(0),
  unit: z.string().default("EA"),
});

const createDailyReportSchema = z.object({
  jobId: z.union([z.number(), z.string()]).nullable().optional(),
  date: z.string().optional(),
  weather: z.string().default("").optional(),
  tempHigh: z.union([z.number(), z.string()]).default(0).optional(),
  tempLow: z.union([z.number(), z.string()]).default(0).optional(),
  crewSize: z.union([z.number(), z.string()]).default(0).optional(),
  workAccomplished: z.string().default("").optional(),
  materialsUsed: z.array(materialSchema).default([]).optional(),
  issues: z.string().default("").optional(),
  tomorrowPlan: z.string().default("").optional(),
  notes: z.string().default("").optional(),
});

const normalizeId = (id: unknown) => {
  if (id === null || id === undefined || id === "") return null;
  if (typeof id === "number") return id;
  if (typeof id === "string" && /^\d+$/.test(id)) return Number(id);
  return id;
};

const normalizeNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const normalizeDate = (value: unknown) => {
  if (!value || typeof value !== "string") return new Date().toISOString().slice(0, 10);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
};

const mapReport = (row: any) => ({
  id: row.id,
  jobId: normalizeId(row.job_id ?? row.jobId),
  date: row.date ?? row.report_date ?? "",
  submittedBy: row.submitted_by ?? row.submittedBy ?? null,
  weather: row.weather ?? "",
  tempHigh: normalizeNumber(row.temp_high ?? row.tempHigh),
  tempLow: normalizeNumber(row.temp_low ?? row.tempLow),
  crewSize: normalizeNumber(row.crew_size ?? row.crewSize),
  workAccomplished: row.work_accomplished ?? row.workAccomplished ?? row.notes ?? "",
  materialsUsed: Array.isArray(row.materials_used ?? row.materialsUsed)
    ? row.materials_used ?? row.materialsUsed
    : [],
  issues: row.issues ?? "",
  tomorrowPlan: row.tomorrow_plan ?? row.tomorrowPlan ?? "",
  notes: row.notes ?? row.work_accomplished ?? row.workAccomplished ?? "",
});

async function insertWithColumnFallback(supabase: any, payload: Record<string, unknown>) {
  const currentPayload = { ...payload };
  let lastResult: any = null;

  for (let i = 0; i < 16; i += 1) {
    const result = await supabase
      .from("daily_reports")
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

export async function GET() {
  try {
    const { supabase, companyId } = await getCompanyId();
    let result = await supabase
      .from("daily_reports")
      .select("*")
      .eq("company_id", companyId)
      .order("date", { ascending: false });

    if (result.error?.message?.toLowerCase().includes("date")) {
      result = await supabase
        .from("daily_reports")
        .select("*")
        .eq("company_id", companyId)
        .order("report_date", { ascending: false });
    }

    if (result.error?.message?.toLowerCase().includes("report_date")) {
      result = await supabase
        .from("daily_reports")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
    }

    const { data, error } = result;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const mapped = (data ?? []).map(mapReport);
    return NextResponse.json({
      dailyReports: mapped,
      daily_reports: mapped,
      reports: mapped,
    });
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
      await requireRole(["admin", "pm", "foreman"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = createDailyReportSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid daily report payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, companyId, userId } = await getCompanyId();
    const payload = parsed.data;

    const basePayload = {
      company_id: companyId,
      job_id: normalizeId(payload.jobId),
      date: normalizeDate(payload.date),
      report_date: normalizeDate(payload.date),
      weather: payload.weather ?? "",
      temp_high: normalizeNumber(payload.tempHigh),
      temp_low: normalizeNumber(payload.tempLow),
      crew_size: normalizeNumber(payload.crewSize),
      work_accomplished: payload.workAccomplished ?? "",
      materials_used: payload.materialsUsed ?? [],
      issues: payload.issues ?? "",
      tomorrow_plan: payload.tomorrowPlan ?? "",
      notes: payload.notes ?? payload.workAccomplished ?? "",
      submitted_by: userId,
    };

    let result = await insertWithColumnFallback(supabase, basePayload);
    if (result.error?.message?.includes("submitted_by")) {
      const noSubmittedBy: Record<string, unknown> = { ...basePayload };
      delete noSubmittedBy.submitted_by;
      result = await insertWithColumnFallback(supabase, noSubmittedBy);
    }

    const { data, error } = result;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ dailyReport: mapReport(data) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
