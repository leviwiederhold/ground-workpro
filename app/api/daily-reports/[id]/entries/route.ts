/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";

const createEntrySchema = z
  .discriminatedUnion("entry_type", [
    z.object({
      entry_type: z.literal("labor"),
      employee_id: z.union([z.number(), z.string()]),
      hours: z.number().positive(),
    }),
    z.object({
      entry_type: z.literal("equipment"),
      equipment_id: z.union([z.number(), z.string()]),
      hours: z.number().positive(),
    }),
    z.object({
      entry_type: z.literal("material"),
      description: z.string().optional(),
      quantity: z.number().positive().optional(),
    }),
    z.object({
      entry_type: z.literal("note"),
      description: z.string().optional(),
    }),
  ])
  .superRefine((value: any, ctx: any) => {
    if (value.entry_type === "material") {
      const hasDescription = Boolean(value.description && value.description.trim());
      const hasQuantity = value.quantity !== undefined;
      if (!hasDescription && !hasQuantity) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "material requires description or quantity",
          path: ["description"],
        });
      }
    }

    if (value.entry_type === "note") {
      const hasDescription = Boolean(value.description && value.description.trim());
      if (!hasDescription) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "note requires description",
          path: ["description"],
        });
      }
    }
  });

const normalizeId = (id: unknown): string | number | null => {
  if (id === null || id === undefined || id === "") return null;
  if (typeof id === "number") return id;
  if (typeof id === "string" && /^\d+$/.test(id)) return Number(id);
  if (typeof id === "string") return id;
  return String(id);
};

const normalizeNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const mapEntry = (row: any) => ({
  id: row.id,
  daily_report_id: normalizeId(row.daily_report_id ?? row.report_id ?? row.dailyReportId),
  entry_type: row.entry_type ?? row.entryType ?? "",
  employee_id: normalizeId(row.employee_id ?? row.employeeId),
  equipment_id: normalizeId(row.equipment_id ?? row.equipmentId),
  hours: normalizeNumber(row.hours),
  description: row.description ?? "",
  quantity: normalizeNumber(row.quantity),
  created_at: row.created_at ?? row.createdAt ?? "",
});

async function insertWithColumnFallback(supabase: any, payload: Record<string, unknown>) {
  const currentPayload = { ...payload };
  let lastResult: any = null;

  for (let i = 0; i < 20; i += 1) {
    const result = await supabase
      .from("daily_report_entries")
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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { supabase, companyId } = await getCompanyId();
    const reportId = normalizeId(id);
    if (reportId === null) {
      return NextResponse.json({ error: "Invalid report id" }, { status: 400 });
    }

    const { data: reportRows, error: reportError } = await supabase
      .from("daily_reports")
      .select("id")
      .eq("company_id", companyId)
      .eq("id", reportId)
      .limit(1);

    if (reportError || !(reportRows && reportRows.length > 0)) {
      return NextResponse.json({ error: "Daily report not found" }, { status: 404 });
    }

    let result = await supabase
      .from("daily_report_entries")
      .select("*")
      .eq("company_id", companyId)
      .eq("daily_report_id", reportId)
      .order("created_at", { ascending: false });

    if (result.error?.message?.toLowerCase().includes("daily_report_id")) {
      result = await supabase
        .from("daily_report_entries")
        .select("*")
        .eq("company_id", companyId)
        .eq("report_id", reportId)
        .order("created_at", { ascending: false });
    }

    if (result.error?.message?.toLowerCase().includes("created_at")) {
      result = await supabase
        .from("daily_report_entries")
        .select("*")
        .eq("company_id", companyId)
        .eq("daily_report_id", reportId)
        .order("id", { ascending: false });
    }

    const { data, error } = result;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ entries: (data ?? []).map(mapEntry) });
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

    const parsed = createEntrySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid entry payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, companyId } = await getCompanyId();
    const reportId = normalizeId(id);
    if (reportId === null) {
      return NextResponse.json({ error: "Invalid report id" }, { status: 400 });
    }

    const { data: reportRows, error: reportError } = await supabase
      .from("daily_reports")
      .select("id")
      .eq("company_id", companyId)
      .eq("id", reportId)
      .limit(1);

    if (reportError || !(reportRows && reportRows.length > 0)) {
      return NextResponse.json({ error: "Daily report not found" }, { status: 404 });
    }

    const payload = parsed.data;
    const insertPayload: Record<string, unknown> = {
      company_id: companyId,
      daily_report_id: reportId,
      report_id: reportId,
      entry_type: payload.entry_type,
    };

    if (payload.entry_type === "labor") {
      insertPayload.employee_id = normalizeId(payload.employee_id);
      insertPayload.hours = payload.hours;
    } else if (payload.entry_type === "equipment") {
      insertPayload.equipment_id = normalizeId(payload.equipment_id);
      insertPayload.hours = payload.hours;
    } else {
      insertPayload.description = payload.description;
      if (payload.entry_type === "material" && payload.quantity !== undefined) {
        insertPayload.quantity = payload.quantity;
      }
    }

    const { data, error } = await insertWithColumnFallback(supabase, insertPayload);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ entry: mapEntry(data) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
