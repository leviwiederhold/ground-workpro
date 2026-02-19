/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";

const vendorStatusSchema = z.enum(["active", "inactive", "preferred", "blocked"]);

const createVendorSchema = z.object({
  name: z.string().min(1),
  status: vendorStatusSchema.default("active").optional(),
  category: z.string().default("").optional(),
  contact_name: z.string().default("").optional(),
  contact: z.string().default("").optional(),
  phone: z.string().default("").optional(),
  email: z.string().default("").optional(),
  rating: z.number().min(0).max(5).default(0).optional(),
  active_orders: z.number().nonnegative().default(0).optional(),
  activeOrders: z.number().nonnegative().default(0).optional(),
  notes: z.string().default("").optional(),
});

const normalizeNumber = (value: unknown, fallback = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const mapVendor = (row: any) => ({
  id: row.id,
  name: row.name ?? "",
  status: row.status ?? "active",
  category: row.category ?? "",
  contact: row.contact_name ?? row.contact ?? "",
  contact_name: row.contact_name ?? row.contact ?? "",
  phone: row.phone ?? "",
  email: row.email ?? "",
  rating: normalizeNumber(row.rating ?? 0),
  activeOrders: normalizeNumber(row.active_orders ?? row.activeOrders ?? 0),
  active_orders: normalizeNumber(row.active_orders ?? row.activeOrders ?? 0),
  notes: row.notes ?? "",
});

async function insertWithColumnFallback(supabase: any, payload: Record<string, unknown>) {
  const currentPayload = { ...payload };
  let lastResult: any = null;

  for (let i = 0; i < 20; i += 1) {
    const result = await supabase.from("vendors").insert(currentPayload).select("*").single();
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
      .from("vendors")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (result.error?.message?.toLowerCase().includes("created_at")) {
      result = await supabase
        .from("vendors")
        .select("*")
        .eq("company_id", companyId)
        .order("id", { ascending: false });
    }

    const { data, error } = result;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ vendors: (data ?? []).map(mapVendor) });
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

    const parsed = createVendorSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid vendor payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, companyId, userId } = await getCompanyId();
    const payload = parsed.data;

    const basePayload = {
      company_id: companyId,
      created_by: userId,
      name: payload.name,
      category: payload.category ?? "",
      contact_name: payload.contact_name ?? payload.contact ?? "",
      contact: payload.contact ?? payload.contact_name ?? "",
      phone: payload.phone ?? "",
      email: payload.email ?? "",
      rating: normalizeNumber(payload.rating ?? 0),
      active_orders: normalizeNumber(payload.active_orders ?? payload.activeOrders ?? 0),
      notes: payload.notes ?? "",
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

    const { data, error } = result;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ vendor: mapVendor(data) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
