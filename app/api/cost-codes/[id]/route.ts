/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";

const costCodeStatusSchema = z.enum(["active", "inactive", "archived"]);

const updateCostCodeSchema = z
  .object({
    code: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    status: costCodeStatusSchema.optional(),
    budgeted: z.number().nonnegative().optional(),
  })
  .refine((value: any) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

const normalizeRouteId = (id: string) => (/^\d+$/.test(id) ? Number(id) : id);
const normalizeCode = (code: string) => code.trim().toUpperCase();
const normalizeNumber = (value: unknown, fallback = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const mapCostCode = (row: any) => ({
  id: row.id,
  code: row.code ?? "",
  name: row.name ?? row.description ?? "",
  description: row.name ?? row.description ?? "",
  status: row.status ?? "active",
  budgeted: normalizeNumber(row.budgeted ?? 0),
});

async function updateWithColumnFallback(
  supabase: any,
  companyId: string,
  id: string | number,
  payload: Record<string, unknown>
) {
  const currentPayload = { ...payload };
  let lastResult: any = null;

  for (let i = 0; i < 20; i += 1) {
    const result = await supabase
      .from("cost_codes")
      .update(currentPayload)
      .eq("company_id", companyId)
      .eq("id", id);
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
      await requireRole(["admin", "pm"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const rowId = normalizeRouteId(id);
    const body = await request.json();

    if (
      body &&
      typeof body === "object" &&
      ("company_id" in body || "created_by" in body || "created_at" in body)
    ) {
      return NextResponse.json(
        { error: "company_id, created_by, and created_at cannot be updated" },
        { status: 400 }
      );
    }

    const parsed = updateCostCodeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid cost code payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, companyId } = await getCompanyId();
    const payload = parsed.data;

    if (payload.code !== undefined) {
      const normalizedCode = normalizeCode(payload.code);
      const { data: existing, error: existingError } = await supabase
        .from("cost_codes")
        .select("id")
        .eq("company_id", companyId)
        .eq("code", normalizedCode)
        .neq("id", rowId)
        .limit(1);

      if (existingError) {
        return NextResponse.json({ error: existingError.message }, { status: 400 });
      }

      if (existing && existing.length > 0) {
        return NextResponse.json({ error: `Cost code ${normalizedCode} already exists` }, { status: 409 });
      }
    }

    const updatePayload: Record<string, unknown> = {};
    if (payload.code !== undefined) updatePayload.code = normalizeCode(payload.code);
    if (payload.name !== undefined) {
      updatePayload.name = payload.name.trim();
      updatePayload.description = payload.name.trim();
    }
    if (payload.status !== undefined) updatePayload.status = payload.status;
    if (payload.budgeted !== undefined) updatePayload.budgeted = normalizeNumber(payload.budgeted);

    const { error } = await updateWithColumnFallback(supabase, companyId, rowId, updatePayload);

    if (error) {
      if (error.message?.toLowerCase().includes("duplicate") || error.message?.includes("unique")) {
        return NextResponse.json({ error: "Cost code already exists" }, { status: 409 });
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const { data: updatedRow, error: fetchError } = await supabase
      .from("cost_codes")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", rowId)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 400 });
    }

    if (!updatedRow) {
      return NextResponse.json({ error: "Cost code not found" }, { status: 404 });
    }

    return NextResponse.json({ cost_code: mapCostCode(updatedRow) });
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
      await requireRole(["admin", "pm"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const rowId = normalizeRouteId(id);
    const { supabase, companyId } = await getCompanyId();

    const { error } = await supabase
      .from("cost_codes")
      .delete()
      .eq("company_id", companyId)
      .eq("id", rowId);

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
