/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "zod";
import { ForbiddenError, requireModuleAccess } from "@/lib/auth/requireRole";
import { ASSIGNMENT_CONFLICT_CODE } from "@/lib/jobs/assignmentConflict";
import { runJobAssignmentSideEffects } from "@/lib/jobs/assignmentSideEffects";
import { reassignEmployeeToJob } from "@/lib/jobs/assignmentService";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";

const reassignEmployeeSchema = z.object({
  employee_id: z.union([z.number(), z.string()]),
  from_job_id: z.union([z.number(), z.string()]),
  assigned_role: z.string().optional(),
});

const normalizeId = (id: unknown): string | number | null => {
  if (id === null || id === undefined || id === "") return null;
  if (typeof id === "number") return id;
  if (typeof id === "string" && /^\d+$/.test(id)) return Number(id);
  if (typeof id === "string") return id;
  return String(id);
};

const employeeName = (employee: Record<string, any>) =>
  String(employee.name ?? employee.full_name ?? "Employee");

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const parsed = reassignEmployeeSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid reassignment payload", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const access = await requireModuleAccess("jobs", "edit");
    const { supabase } = await getCompanyId();
    const { companyId, userId } = access;
    const toJobId = normalizeId(id);
    const fromJobId = normalizeId(parsed.data.from_job_id);
    const employeeId = normalizeId(parsed.data.employee_id);
    if (toJobId === null || fromJobId === null || employeeId === null) {
      return NextResponse.json({ error: "Invalid job or employee id" }, { status: 400 });
    }
    if (String(toJobId) === String(fromJobId)) {
      return NextResponse.json(
        { error: "Current and destination jobs must be different" },
        { status: 400 },
      );
    }

    const { data: jobRows, error: jobError } = await supabase
      .from("jobs")
      .select("id, name, status")
      .eq("company_id", companyId)
      .in("id", [fromJobId, toJobId]);
    if (jobError) {
      return NextResponse.json({ error: jobError.message }, { status: 400 });
    }
    const targetJob = (jobRows ?? []).find((job: any) => String(job.id) === String(toJobId));
    const sourceJob = (jobRows ?? []).find((job: any) => String(job.id) === String(fromJobId));
    if (!targetJob) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    if (!sourceJob) {
      return NextResponse.json({ error: "Current job not found" }, { status: 404 });
    }

    const { data: employeeRows, error: employeeError } = await supabase
      .from("employees")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", employeeId)
      .limit(1);
    if (employeeError || !(employeeRows && employeeRows.length > 0)) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }
    const employee = employeeRows[0];

    const admin = getSupabaseAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Atomic assignment service unavailable" }, { status: 503 });
    }

    const result = await reassignEmployeeToJob({
      supabase: admin,
      companyId,
      fromJobId: String(fromJobId),
      toJobId: String(toJobId),
      employeeId: String(employeeId),
      assignedRole: parsed.data.assigned_role ?? null,
    });

    if (result.status === "conflict") {
      return NextResponse.json(
        {
          code: ASSIGNMENT_CONFLICT_CODE,
          error: `${employeeName(employee)} is already assigned to ${result.currentJob.name}.`,
          employee: { id: String(employeeId), name: employeeName(employee) },
          currentJob: result.currentJob,
        },
        { status: 409 },
      );
    }
    if (result.status === "source_assignment_not_found") {
      return NextResponse.json(
        { error: "The employee is no longer assigned to the current job. Refresh and try again." },
        { status: 409 },
      );
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
    if (result.status !== "reassigned") {
      return NextResponse.json(
        { error: "message" in result ? result.message : "Failed to reassign employee" },
        { status: 400 },
      );
    }

    await runJobAssignmentSideEffects({
      supabase,
      companyId,
      actorUserId: userId,
      employee,
      job: targetJob,
      previousJobId: String(fromJobId),
    });

    return NextResponse.json({
      success: true,
      employee: { id: String(employeeId), name: employeeName(employee) },
      fromJob: { id: String(fromJobId), name: String(sourceJob.name ?? "Current job") },
      job: { id: String(toJobId), name: String(targetJob.name ?? "New job") },
    });
  } catch (error) {
    if (error instanceof TenantResolverError || error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
