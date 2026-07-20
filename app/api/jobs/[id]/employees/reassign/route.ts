import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { reassignEmployee } from "@/lib/jobs/assignmentService";

const reassignSchema = z.object({
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

/**
 * Atomically move an employee from `from_job_id` to the job in the path (`id`):
 * removes the old crew membership and adds the new one as a single operation,
 * conflict-checked against the employee's OTHER active jobs. Used by the
 * reassignment confirmation flow when an assignment conflict is detected.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const parsed = reassignSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid reassignment payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, companyId } = await getCompanyId();
    const toJobId = normalizeId(id);
    const fromJobId = normalizeId(parsed.data.from_job_id);
    const employeeId = normalizeId(parsed.data.employee_id);
    if (toJobId === null || fromJobId === null || employeeId === null) {
      return NextResponse.json({ error: "Invalid job or employee id" }, { status: 400 });
    }
    if (String(toJobId) === String(fromJobId)) {
      return NextResponse.json({ error: "Source and target jobs are the same" }, { status: 400 });
    }

    // Confirm the employee belongs to this company (tenant safety + clear 404).
    const { data: employeeRows, error: employeeError } = await supabase
      .from("employees")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", employeeId)
      .limit(1);
    if (employeeError || !(employeeRows && employeeRows.length > 0)) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    const result = await reassignEmployee({
      supabase,
      companyId,
      fromJobId,
      toJobId,
      employeeId,
      assignedRole: parsed.data.assigned_role ?? null,
    });

    switch (result.status) {
      case "job_not_found":
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
      case "conflict":
        // Reassignment still conflicts with a DIFFERENT active job.
        return NextResponse.json(result.conflict, { status: 409 });
      case "error":
        return NextResponse.json({ error: result.message }, { status: 400 });
      case "unsupported":
        return NextResponse.json(
          { error: "Reassignment is not supported for this workspace's schema" },
          { status: 400 }
        );
      case "assigned":
      case "already_assigned":
      default:
        return NextResponse.json({
          success: true,
          employee_id: employeeId,
          from_job_id: fromJobId,
          to_job_id: toJobId,
        });
    }
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
