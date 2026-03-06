/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { logAuditEvent } from "@/lib/audit/logAuditEvent";
import { errorResponse } from "@/lib/http/errorResponse";

const ROUTE = "/api/pricing-settings";

const pricingSettingsSchema = z
  .object({
    operator_labor_rate: z.number().finite().nonnegative().optional(),
    labor_burden_percent: z.number().finite().nonnegative().optional(),
    hauling_rate_per_hour: z.number().finite().nonnegative().optional(),
    dump_fee_per_load: z.number().finite().nonnegative().optional(),
    target_margin_percent: z.number().finite().nonnegative().optional(),
    contingency_percent: z.number().finite().nonnegative().optional(),
    markup_percent: z.number().finite().nonnegative().optional(),
  })
  .refine((value: Record<string, unknown>) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

const normalizeNumber = (value: unknown, fallback = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const mapPricingSettings = (row: any) => ({
  id: row.id,
  company_id: row.company_id,
  operator_labor_rate: normalizeNumber(row.operator_labor_rate),
  labor_burden_percent: normalizeNumber(row.labor_burden_percent),
  hauling_rate_per_hour: normalizeNumber(row.hauling_rate_per_hour),
  dump_fee_per_load: normalizeNumber(row.dump_fee_per_load),
  target_margin_percent: normalizeNumber(row.target_margin_percent),
  contingency_percent: normalizeNumber(row.contingency_percent),
  markup_percent: normalizeNumber(row.markup_percent),
  created_at: row.created_at ?? null,
  updated_at: row.updated_at ?? null,
});

async function upsertWithColumnFallback(supabase: any, payload: Record<string, unknown>) {
  const currentPayload = { ...payload };
  let lastResult: any = null;

  for (let i = 0; i < 20; i += 1) {
    const result = await supabase
      .from("pricing_settings")
      .upsert(currentPayload, { onConflict: "company_id" })
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
  let context: { companyId?: string; userId?: string; role?: string } = {};
  try {
    try {
      const access = await requireRole(["admin", "pm"]);
      context = { companyId: access.companyId, userId: access.userId, role: access.role };
    } catch {
      return errorResponse("Forbidden", 403);
    }

    const { supabase, companyId, userId } = await getCompanyId();
    context = { ...context, companyId, userId };

    const { data, error } = await supabase
      .from("pricing_settings")
      .select("*")
      .eq("company_id", companyId)
      .maybeSingle();

    if (error) {
      return errorResponse(error.message, 400);
    }

    return NextResponse.json({
      pricing_settings: data ? mapPricingSettings(data) : null,
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return errorResponse(error.message, error.status);
    }
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(message || "Unexpected server error", 500, {
      context: { route: ROUTE, ...context },
    });
  }
}

export async function PUT(request: Request) {
  let context: { companyId?: string; userId?: string; role?: string } = {};
  try {
    try {
      const access = await requireRole(["admin"]);
      context = { companyId: access.companyId, userId: access.userId, role: access.role };
    } catch {
      return errorResponse("Forbidden", 403);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("Invalid JSON body", 400);
    }

    const parsed = pricingSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid pricing settings payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, companyId, userId } = await getCompanyId();
    const payload = parsed.data;

    const upsertPayload: Record<string, unknown> = {
      company_id: companyId,
      updated_by: userId,
      ...payload,
    };

    const { data, error } = await upsertWithColumnFallback(supabase, upsertPayload);

    if (error) {
      return errorResponse(error.message, 400);
    }

    await logAuditEvent({
      supabase,
      companyId,
      actorUserId: userId,
      eventType: "pricing.settings.updated",
      entityType: "pricing_settings",
      entityId: data?.id ?? null,
      metadata: payload,
    });

    return NextResponse.json({ pricing_settings: mapPricingSettings(data) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return errorResponse(error.message, error.status);
    }
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(message || "Unexpected server error", 500, {
      context: { route: ROUTE, ...context },
    });
  }
}
