/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";

const costCodeStatusSchema = z.enum(["active", "inactive", "archived"]);

const createCostCodeSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  status: costCodeStatusSchema.default("active").optional(),
  budgeted: z.number().nonnegative().default(0).optional(),
});

const normalizeNumber = (value: unknown, fallback = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const normalizeCode = (code: string) => code.trim().toUpperCase();

const mapCostCode = (row: any) => ({
  id: row.id,
  code: row.code ?? "",
  name: row.name ?? row.description ?? "",
  description: row.name ?? row.description ?? "",
  status: row.status ?? "active",
  budgeted: normalizeNumber(row.budgeted ?? 0),
});

async function insertWithColumnFallback(supabase: any, payload: Record<string, unknown>) {
  const currentPayload = { ...payload };
  let lastResult: any = null;

  for (let i = 0; i < 20; i += 1) {
    const result = await supabase
      .from("cost_codes")
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
      .from("cost_codes")
      .select("*")
      .eq("company_id", companyId)
      .order("code", { ascending: true });

    if (result.error?.message?.toLowerCase().includes("code")) {
      result = await supabase
        .from("cost_codes")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
    }

    if (result.error?.message?.toLowerCase().includes("created_at")) {
      result = await supabase
        .from("cost_codes")
        .select("*")
        .eq("company_id", companyId)
        .order("id", { ascending: false });
    }

    const { data, error } = result;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ cost_codes: (data ?? []).map(mapCostCode) });
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
      await requireRole(["admin", "pm"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = createCostCodeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid cost code payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, companyId, userId } = await getCompanyId();
    const payload = parsed.data;
    const normalizedCode = normalizeCode(payload.code);

    const { data: existing, error: existingError } = await supabase
      .from("cost_codes")
      .select("id")
      .eq("company_id", companyId)
      .eq("code", normalizedCode)
      .limit(1);

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 400 });
    }

    if (existing && existing.length > 0) {
      return NextResponse.json({ error: `Cost code ${normalizedCode} already exists` }, { status: 409 });
    }

    const basePayload = {
      company_id: companyId,
      created_by: userId,
      code: normalizedCode,
      name: payload.name.trim(),
      description: payload.name.trim(),
      budgeted: normalizeNumber(payload.budgeted),
    };

    let result = await insertWithColumnFallback(supabase, {
      ...basePayload,
      ...(payload.status ? { status: payload.status } : {}),
    });

    if (result.error?.message?.toLowerCase().includes("status") && payload.status) {
      result = await insertWithColumnFallback(supabase, basePayload);
    }

    if (result.error?.message?.toLowerCase().includes("created_by")) {
      const withoutCreatedBy: Record<string, unknown> = { ...basePayload };
      delete withoutCreatedBy.created_by;
      result = await insertWithColumnFallback(supabase, withoutCreatedBy);
    }

    if (result.error?.message?.toLowerCase().includes("duplicate") || result.error?.message?.includes("unique")) {
      return NextResponse.json({ error: `Cost code ${normalizedCode} already exists` }, { status: 409 });
    }

    const { data, error } = result;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ cost_code: mapCostCode(data) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
