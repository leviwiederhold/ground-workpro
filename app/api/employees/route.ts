/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireModuleAccess } from "@/lib/auth/requireRole";
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

const isMissingSchemaError = (message: string | undefined) =>
  /(column .* does not exist|Could not find the '.*' column|relation .* does not exist|Could not find the table)/i.test(
    message ?? ""
  );

// Resolve each employee's assigned job (id + name) so the UI never has to fall
// back to "Unassigned" just because the bare job_id column was empty or a job
// name was never joined. Assignments primarily live in the job_employees join
// table (matching how attendance/scheduling read them); the employee row's own
// job_id column is used as a fallback. Job names are looked up in one batch.
// Mutates each employee in place, setting jobId + jobName. Degrades gracefully
// (leaves the existing jobId, jobName null) if the join table is absent.
async function hydrateAssignedJobs(
  supabase: any,
  companyId: string,
  employees: Array<{ id: unknown; jobId: unknown; jobName?: string | null }>
) {
  if (employees.length === 0) return;
  const employeeIds = employees.map((e) => e.id).filter((id) => id !== null && id !== undefined && id !== "");

  const jobIdByEmployeeId = new Map<string, string>();
  if (employeeIds.length > 0) {
    const assignments = await supabase
      .from("job_employees")
      .select("employee_id, job_id, created_at")
      .eq("company_id", companyId)
      .in("employee_id", employeeIds as Array<string | number>)
      .order("created_at", { ascending: true });
    if (!assignments.error) {
      for (const row of (assignments.data ?? []) as Array<Record<string, unknown>>) {
        const eid = String(normalizeId(row.employee_id) ?? "");
        const jid = normalizeId(row.job_id);
        if (!eid || jid === null || jid === undefined || jid === "") continue;
        if (!jobIdByEmployeeId.has(eid)) jobIdByEmployeeId.set(eid, String(jid));
      }
    } else if (!isMissingSchemaError(assignments.error.message)) {
      // A real error (not just a missing table) — surface nothing, keep going
      // with the row-level job_id fallback below.
    }
  }

  // Final assigned jobId per employee: join assignment first, else the row's
  // own job_id (already on e.jobId from mapEmployee).
  const jobIds = new Set<string>();
  for (const e of employees) {
    const fromJoin = jobIdByEmployeeId.get(String(e.id));
    const own = e.jobId !== null && e.jobId !== undefined && e.jobId !== "" ? String(e.jobId) : "";
    const resolved = fromJoin || own;
    e.jobId = resolved || null;
    if (resolved) jobIds.add(resolved);
  }

  let jobNameById = new Map<string, string>();
  if (jobIds.size > 0) {
    const jobsResult = await supabase
      .from("jobs")
      .select("id, name")
      .eq("company_id", companyId)
      .in("id", Array.from(jobIds));
    if (!jobsResult.error) {
      jobNameById = new Map(
        (jobsResult.data ?? []).map((job: Record<string, unknown>) => [
          String(normalizeId(job.id) ?? job.id),
          String(job.name ?? "Job"),
        ])
      );
    }
  }

  for (const e of employees) {
    e.jobName = e.jobId ? jobNameById.get(String(e.jobId)) ?? null : null;
  }
}

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

const mapEmployee = (row: any) => {
  const id = row?.id;
  if (id === null || id === undefined || id === "") return null;

  return {
    id,
    name: row.name ?? row.full_name ?? "",
    role: String(row.role ?? "operator").trim().toLowerCase(),
    user_id: row.user_id ?? null,
    phone: row.phone ?? "",
    email: row.email ?? "",
    certifications: parseCertifications(row.certifications),
    jobId: normalizeId(row.job_id ?? row.jobId),
    // Hydrated by hydrateAssignedJobs() after the batch job-name lookup.
    jobName: null as string | null,
    status: row.status ?? "off",
    clockedInAt: row.clocked_in_at ?? row.clockedInAt ?? null,
  };
};

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
    const postgrest = message.match(/Could not find the '([^']+)' column/i);
    const postgres = message.match(/column\s+employees\.([a-zA-Z0-9_]+)\s+does not exist/i);
    const relation = message.match(/column\s+"?([a-zA-Z0-9_]+)"?\s+of relation\s+"?employees"?\s+does not exist/i);
    const generic = message.match(/column\s+"?([a-zA-Z0-9_]+)"?\s+does not exist/i);
    const missingColumn = postgrest?.[1] ?? postgres?.[1] ?? relation?.[1] ?? generic?.[1];
    if (!missingColumn) return result;
    if (!(missingColumn in currentPayload)) return result;
    delete currentPayload[missingColumn];
  }

  return lastResult;
}

export async function GET(request: Request) {
  try {
    try {
      await requireModuleAccess("team_management", "view");
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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

    const employees = (data ?? []).map(mapEmployee).filter(Boolean) as Array<{ id: unknown; jobId: unknown; jobName?: string | null }>;
    await hydrateAssignedJobs(supabase, companyId, employees);
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
    let actorRole = "";
    try {
      const access = await requireModuleAccess("team_management", "edit");
      actorRole = access.role;
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
    if (payload.hourlyRate !== undefined && payload.hourlyRate > 0 && actorRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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

    const employee = mapEmployee(data);
    if (!employee) {
      return NextResponse.json({ error: "Employee create returned no row" }, { status: 500 });
    }

    return NextResponse.json({ employee });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
