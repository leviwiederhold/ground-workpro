/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireModuleAccess } from "@/lib/auth/requireRole";

const materialSchema = z.object({
  item: z.string().default(""),
  qty: z.union([z.number(), z.string()]).default(0),
  unit: z.string().default("EA"),
});

const updateDailyReportSchema = z
  .object({
    jobId: z.union([z.number(), z.string()]).nullable().optional(),
    date: z.string().optional(),
    weather: z.string().optional(),
    tempHigh: z.union([z.number(), z.string()]).optional(),
    tempLow: z.union([z.number(), z.string()]).optional(),
    crewSize: z.union([z.number(), z.string()]).optional(),
    workAccomplished: z.string().optional(),
    materialsUsed: z.array(materialSchema).optional(),
    issues: z.string().optional(),
    tomorrowPlan: z.string().optional(),
    notes: z.string().optional(),
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

const normalizeNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const normalizeDate = (value: unknown) => {
  if (!value || typeof value !== "string") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
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
      .from("daily_reports")
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
      await requireModuleAccess("daily_reports", "edit");
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    if (
      body &&
      typeof body === "object" &&
      ("company_id" in body || "created_by" in body || "created_at" in body || "submitted_by" in body)
    ) {
      return NextResponse.json(
        { error: "company_id, created_by, created_at, and submitted_by cannot be updated" },
        { status: 400 }
      );
    }

    const parsed = updateDailyReportSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid daily report payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, companyId } = await getCompanyId();
    const payload = parsed.data;
    const updatePayload: Record<string, unknown> = {};

    if (payload.jobId !== undefined) updatePayload.job_id = normalizeId(payload.jobId);
    if (payload.date !== undefined) {
      const normalized = normalizeDate(payload.date);
      updatePayload.date = normalized;
      updatePayload.report_date = normalized;
    }
    if (payload.weather !== undefined) updatePayload.weather = payload.weather;
    if (payload.tempHigh !== undefined) updatePayload.temp_high = normalizeNumber(payload.tempHigh);
    if (payload.tempLow !== undefined) updatePayload.temp_low = normalizeNumber(payload.tempLow);
    if (payload.crewSize !== undefined) updatePayload.crew_size = normalizeNumber(payload.crewSize);
    if (payload.workAccomplished !== undefined) updatePayload.work_accomplished = payload.workAccomplished;
    if (payload.materialsUsed !== undefined) updatePayload.materials_used = payload.materialsUsed;
    if (payload.issues !== undefined) updatePayload.issues = payload.issues;
    if (payload.tomorrowPlan !== undefined) updatePayload.tomorrow_plan = payload.tomorrowPlan;
    if (payload.notes !== undefined) updatePayload.notes = payload.notes;

    const { data, error } = await updateWithColumnFallback(
      supabase,
      companyId,
      normalizeRouteId(id),
      updatePayload
    );

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

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    try {
      await requireModuleAccess("daily_reports", "edit");
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const { supabase, companyId } = await getCompanyId();

    const { error } = await supabase
      .from("daily_reports")
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
