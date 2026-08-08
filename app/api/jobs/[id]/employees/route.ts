/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "zod";
import { ForbiddenError, requireModuleAccess } from "@/lib/auth/requireRole";
import { ASSIGNMENT_CONFLICT_CODE } from "@/lib/jobs/assignmentConflict";
import { runJobAssignmentSideEffects } from "@/lib/jobs/assignmentSideEffects";
import { assignEmployeeToJob } from "@/lib/jobs/assignmentService";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";

const assignEmployeeSchema = z.object({
  employee_id: z.union([z.number(), z.string()]),
  assigned_role: z.string().optional(),
});

const normalizeId = (id: unknown): string | number | null => {
  if (id === null || id === undefined || id === "") return null;
  if (typeof id === "number") return id;
  if (typeof id === "string" && /^\d+$/.test(id)) return Number(id);
  if (typeof id === "string") return id;
  return String(id);
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
  role: row.role ?? "Laborer",
  assigned_role: row.assigned_role ?? null,
  phone: row.phone ?? "",
  email: row.email ?? "",
  hourlyRate: Number(row.hourly_rate ?? row.hourlyRate ?? 0),
  certifications: parseCertifications(row.certifications),
  jobId: normalizeId(row.job_id ?? row.jobId),
  status: row.status ?? "off",
  clockedInAt: row.clocked_in_at ?? row.clockedInAt ?? null,
});

const isMissingColumnOrTable = (message: string) =>
  /column .* does not exist/i.test(message) ||
  /Could not find the '.*' column/i.test(message) ||
  /relation .* does not exist/i.test(message) ||
  /Could not find the table/i.test(message);

async function getEmployeeById(supabase: any, companyId: string, employeeId: string | number) {
  return supabase
    .from("employees")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", employeeId)
    .limit(1);
}
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { supabase, companyId } = await getCompanyId();
    const jobId = normalizeId(id);

    const { data: jobRows, error: jobError } = await supabase
      .from("jobs")
      .select("id")
      .eq("company_id", companyId)
      .eq("id", jobId)
      .limit(1);

    if (jobError || !(jobRows && jobRows.length > 0)) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const assignmentsResult = await supabase
      .from("job_employees")
      .select("employee_id, assigned_role")
      .eq("company_id", companyId)
      .eq("job_id", jobId);

    if (!assignmentsResult.error) {
      const assignments = assignmentsResult.data ?? [];
      if (assignments.length === 0) return NextResponse.json({ employees: [] });

      const ids = assignments
        .map((assignment: any) => normalizeId(assignment.employee_id))
        .filter((value) => value !== null);
      if (ids.length === 0) return NextResponse.json({ employees: [] });

      const { data: employeeRows, error: employeesError } = await supabase
        .from("employees")
        .select("*")
        .eq("company_id", companyId)
        .in("id", ids as Array<string | number>);
      if (employeesError) {
        return NextResponse.json({ error: employeesError.message }, { status: 400 });
      }

      const roleMap = new Map(
        assignments.map((assignment: any) => [
          String(assignment.employee_id),
          assignment.assigned_role ?? null,
        ]),
      );
      const mapped = (employeeRows ?? []).map((employee: any) => ({
        ...mapEmployee(employee),
        assigned_role: roleMap.get(String(employee.id)) ?? null,
      }));
      return NextResponse.json({ employees: mapped });
    }

    // Read-only compatibility for older workspaces. Writes intentionally do
    // not have a legacy fallback because assignment enforcement must be atomic.
    if (!isMissingColumnOrTable(assignmentsResult.error?.message || "")) {
      return NextResponse.json(
        { error: assignmentsResult.error?.message || "Failed to load job employees" },
        { status: 400 },
      );
    }

    for (const column of ["job_id", "assigned_job_id", "current_job_id"]) {
      const result = await supabase
        .from("employees")
        .select("*")
        .eq("company_id", companyId)
        .eq(column, jobId);
      if (result.error) {
        if (isMissingColumnOrTable(result.error.message || "")) continue;
        return NextResponse.json({ error: result.error.message }, { status: 400 });
      }
      return NextResponse.json({ employees: (result.data ?? []).map(mapEmployee) });
    }

    return NextResponse.json({ error: "No supported employee assignment schema found" }, { status: 400 });
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
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const parsed = assignEmployeeSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid assignment payload", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const access = await requireModuleAccess("jobs", "edit");
    const { supabase } = await getCompanyId();
    const { companyId, userId } = access;
    const jobId = normalizeId(id);
    const employeeId = normalizeId(parsed.data.employee_id);
    if (jobId === null || employeeId === null) {
      return NextResponse.json({ error: "Invalid job or employee id" }, { status: 400 });
    }

    const { data: jobRows, error: jobError } = await supabase
      .from("jobs")
      .select("id, name, status")
      .eq("company_id", companyId)
      .eq("id", jobId)
      .limit(1);
    if (jobError || !(jobRows && jobRows.length > 0)) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const { data: employeeRows, error: employeeError } = await getEmployeeById(
      supabase,
      companyId,
      employeeId,
    );
    if (employeeError || !(employeeRows && employeeRows.length > 0)) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }
    const employee = employeeRows[0];
    const mappedEmployee = mapEmployee(employee);

    const admin = getSupabaseAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Atomic assignment service unavailable" }, { status: 503 });
    }

    const result = await assignEmployeeToJob({
      supabase: admin,
      companyId,
      jobId: String(jobId),
      employeeId: String(employeeId),
      assignedRole: parsed.data.assigned_role ?? null,
    });

    if (result.status === "conflict") {
      return NextResponse.json(
        {
          code: ASSIGNMENT_CONFLICT_CODE,
          error: `${mappedEmployee.name || "Employee"} is already assigned to ${result.currentJob.name}.`,
          employee: { id: String(employeeId), name: mappedEmployee.name || "Employee" },
          currentJob: result.currentJob,
        },
        { status: 409 },
      );
    }
    if (result.status === "already_assigned") {
      return NextResponse.json({ error: "Employee is already assigned to this job" }, { status: 409 });
    }
    if (result.status === "job_not_found") {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    if (result.status === "employee_not_found") {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }
    if (result.status === "unavailable") {
      return NextResponse.json({ error: result.message }, { status: 503 });
    }
    if (result.status !== "assigned") {
      return NextResponse.json(
        { error: "message" in result ? result.message : "Failed to assign employee" },
        { status: 400 },
      );
    }

    await runJobAssignmentSideEffects({
      supabase,
      companyId,
      actorUserId: userId,
      employee,
      job: jobRows[0],
    });

    return NextResponse.json({
      employee: {
        ...mappedEmployee,
        assigned_role: parsed.data.assigned_role ?? null,
        jobId,
      },
    });
  } catch (error) {
    if (error instanceof TenantResolverError || error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
