/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { getPaginationFromUrl, getPaginationMeta } from "@/lib/http/pagination";

const employeeStatusSchema = z.enum(["clocked-in", "off", "active", "inactive"]);

const createEmployeeSchema = z.object({
  name: z.string().min(1),
  role: z.string().optional(),
  phone: z.string().default("").optional(),
  email: z.string().default("").optional(),
  hourlyRate: z.number().nonnegative().default(0).optional(),
  certifications: z.array(z.object({ name: z.string(), expires: z.string() })).default([]).optional(),
  jobId: z.union([z.number(), z.string()]).nullable().optional(),
  status: employeeStatusSchema.optional(),
  clockedInAt: z.string().nullable().optional(),
});

const normalizeId = (id: unknown) => {
  if (id === null || id === undefined || id === "") return null;
  if (typeof id === "number") return id;
  if (typeof id === "string" && /^\d+$/.test(id)) return Number(id);
  return id;
};

const parseCertifications = (value: unknown) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const mapEmployee = (row: any) => ({
  id: row.id,
  name: row.name ?? row.full_name ?? "",
  role: String(row.role ?? "operator").trim().toLowerCase(),
  user_id: row.user_id ?? null,
  phone: row.phone ?? "",
  email: row.email ?? "",
  hourlyRate: Number(row.hourly_rate ?? row.hourlyRate ?? row.pay_rate ?? row.rate ?? 0),
  certifications: parseCertifications(row.certifications),
  jobId: normalizeId(row.job_id ?? row.jobId),
  status: row.status ?? "off",
  clockedInAt: row.clocked_in_at ?? row.clockedInAt ?? null,
});

const isStatusCheckError = (message: string | undefined) =>
  /employees_status_check|violates check constraint .*status/i.test(message ?? "");

const getStatusCandidates = (value: unknown) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "clocked-in") return ["clocked-in", "active", "off", "inactive"];
  if (normalized === "active") return ["active", "clocked-in", "off", "inactive"];
  if (normalized === "off") return ["off", "inactive", "active", "clocked-in"];
  if (normalized === "inactive") return ["inactive", "off", "active", "clocked-in"];
  return [normalized];
};

async function insertWithColumnFallback(supabase: any, payload: Record<string, unknown>) {
  const currentPayload = { ...payload };
  let lastResult: any = null;

  for (let i = 0; i < 20; i += 1) {
    const result = await supabase.from("employees").insert(currentPayload).select("*").single();
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

export async function GET(request: Request) {
  try {
    const { page, pageSize, from, to } = getPaginationFromUrl(request.url, { defaultPageSize: 50, maxPageSize: 200 });
    const { supabase, companyId } = await getCompanyId();
    let result = await supabase
      .from("employees")
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (result.error?.message?.toLowerCase().includes("created_at")) {
      result = await supabase
        .from("employees")
        .select("*", { count: "exact" })
        .eq("company_id", companyId)
        .order("id", { ascending: false })
        .range(from, to);
    }

    const { data, error, count } = result;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const employees = (data ?? []).map(mapEmployee);
    return NextResponse.json({ employees, ...getPaginationMeta(count ?? employees.length, page, pageSize) });
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

    const parsed = createEmployeeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid employee payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, companyId, userId } = await getCompanyId();
    const payload = parsed.data;

    const basePayload = {
      company_id: companyId,
      created_by: userId,
      name: payload.name,
      full_name: payload.name,
      role: payload.role,
      phone: payload.phone ?? "",
      email: payload.email ?? "",
      hourly_rate: payload.hourlyRate ?? 0,
      hourlyRate: payload.hourlyRate ?? 0,
      pay_rate: payload.hourlyRate ?? 0,
      rate: payload.hourlyRate ?? 0,
      certifications: payload.certifications ?? [],
      job_id: normalizeId(payload.jobId),
      clocked_in_at: payload.clockedInAt ?? null,
    };

    let result = await insertWithColumnFallback(supabase, {
      ...basePayload,
      ...(payload.status ? { status: payload.status } : {}),
    });

    if (result.error && payload.status && isStatusCheckError(result.error.message)) {
      const statusCandidates = getStatusCandidates(payload.status);
      for (const candidate of statusCandidates.slice(1)) {
        const retry = await insertWithColumnFallback(supabase, {
          ...basePayload,
          status: candidate,
        });
        result = retry;
        if (!retry.error) break;
      }
    }

    if (result.error && payload.status && isStatusCheckError(result.error.message)) {
      result = await insertWithColumnFallback(supabase, basePayload);
    }

    if (result.error?.message?.toLowerCase().includes("role")) {
      const withoutRole = { ...basePayload };
      delete (withoutRole as Record<string, unknown>).role;
      result = await insertWithColumnFallback(supabase, withoutRole);
    }

    if (result.error?.message?.toLowerCase().includes("created_by")) {
      const withoutCreatedBy = { ...basePayload };
      delete (withoutCreatedBy as Record<string, unknown>).created_by;
      result = await insertWithColumnFallback(supabase, withoutCreatedBy);
    }

    const { data, error } = result;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ employee: mapEmployee(data) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
