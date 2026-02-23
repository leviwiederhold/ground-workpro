import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { enqueueNotifications } from "@/lib/notifications/enqueue";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    let access: Awaited<ReturnType<typeof requireRole>>;
    try {
      access = await requireRole(["admin", "pm"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsedParams = paramsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json(
        {
          error: "Validation error",
          details: parsedParams.error.issues.map((issue: { path: (string | number)[]; message: string }) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 422 }
      );
    }

    const { supabase, companyId } = await getCompanyId();
    const existingAssignmentResult = await supabase
      .from("schedule_assignments")
      .select("id, job_id, date, employee_id, equipment_id")
      .eq("company_id", companyId)
      .eq("id", parsedParams.data.id)
      .maybeSingle();

    if (existingAssignmentResult.error) {
      return NextResponse.json({ error: existingAssignmentResult.error.message }, { status: 400 });
    }
    if (!existingAssignmentResult.data) {
      return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
    }

    const jobResult = await supabase
      .from("jobs")
      .select("id, name")
      .eq("company_id", companyId)
      .eq("id", existingAssignmentResult.data.job_id)
      .maybeSingle();

    const deleteResult = await supabase
      .from("schedule_assignments")
      .delete()
      .eq("company_id", companyId)
      .eq("id", parsedParams.data.id)
      .select("id");

    if (deleteResult.error) {
      return NextResponse.json({ error: deleteResult.error.message }, { status: 400 });
    }

    if (!deleteResult.data || deleteResult.data.length === 0) {
      return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
    }

    await enqueueNotifications({
      supabase,
      companyId,
      userIds: [access.userId],
      type: "assignment_removed",
      payload: {
        assignmentId: existingAssignmentResult.data.id,
        jobId: existingAssignmentResult.data.job_id,
        jobName: jobResult.data?.name ?? "Job",
        date: existingAssignmentResult.data.date,
        employeeId: existingAssignmentResult.data.employee_id,
        equipmentId: existingAssignmentResult.data.equipment_id,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
