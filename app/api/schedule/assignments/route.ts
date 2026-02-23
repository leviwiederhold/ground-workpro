import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { enqueueNotifications } from "@/lib/notifications/enqueue";

const createAssignmentSchema = z
  .object({
    jobId: z.string().uuid(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    employeeId: z.string().uuid().optional(),
    equipmentId: z.string().uuid().optional(),
    notes: z.string().optional(),
  })
  .refine((value: { employeeId?: string; equipmentId?: string }) => Boolean(value.employeeId || value.equipmentId), {
    path: ["employeeId"],
    message: "employeeId or equipmentId is required",
  });

const mapAssignment = (row: Record<string, unknown>) => ({
  id: String(row.id),
  jobId: String(row.job_id),
  date: String(row.date),
  employeeId: row.employee_id ? String(row.employee_id) : null,
  equipmentId: row.equipment_id ? String(row.equipment_id) : null,
  notes: row.notes ? String(row.notes) : "",
  createdBy: row.created_by ? String(row.created_by) : "",
  createdAt: row.created_at ? String(row.created_at) : "",
});

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    let access: Awaited<ReturnType<typeof requireRole>>;
    try {
      access = await requireRole(["admin", "pm", "foreman"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const parsedBody = createAssignmentSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        {
          error: "Validation error",
          details: parsedBody.error.issues.map((issue: { path: (string | number)[]; message: string }) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 422 }
      );
    }

    const { supabase, companyId } = await getCompanyId();
    const payload = parsedBody.data;

    const checks = [
      supabase.from("jobs").select("id, name").eq("company_id", companyId).eq("id", payload.jobId).maybeSingle(),
      payload.employeeId
        ? supabase
            .from("employees")
            .select("id, user_id")
            .eq("company_id", companyId)
            .eq("id", payload.employeeId)
            .maybeSingle()
        : Promise.resolve({ data: { id: null }, error: null }),
      payload.equipmentId
        ? supabase
            .from("equipment")
            .select("id")
            .eq("company_id", companyId)
            .eq("id", payload.equipmentId)
            .maybeSingle()
        : Promise.resolve({ data: { id: null }, error: null }),
    ] as const;

    const [jobResult, employeeResult, equipmentResult] = await Promise.all(checks);

    if (jobResult.error || !jobResult.data) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    if (payload.employeeId && (employeeResult.error || !employeeResult.data)) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }
    if (payload.equipmentId && (equipmentResult.error || !equipmentResult.data)) {
      return NextResponse.json({ error: "Equipment not found" }, { status: 404 });
    }

    const warnings: string[] = [];
    const conflictChecks = await Promise.all([
      payload.employeeId
        ? supabase
            .from("schedule_assignments")
            .select("id, job_id")
            .eq("company_id", companyId)
            .eq("date", payload.date)
            .eq("employee_id", payload.employeeId)
            .neq("job_id", payload.jobId)
            .limit(1)
        : Promise.resolve({ data: [], error: null }),
      payload.equipmentId
        ? supabase
            .from("schedule_assignments")
            .select("id, job_id")
            .eq("company_id", companyId)
            .eq("date", payload.date)
            .eq("equipment_id", payload.equipmentId)
            .neq("job_id", payload.jobId)
            .limit(1)
        : Promise.resolve({ data: [], error: null }),
    ] as const);

    if (conflictChecks[0].error) {
      return NextResponse.json({ error: conflictChecks[0].error.message }, { status: 400 });
    }
    if (conflictChecks[1].error) {
      return NextResponse.json({ error: conflictChecks[1].error.message }, { status: 400 });
    }
    if ((conflictChecks[0].data ?? []).length > 0) {
      warnings.push("Employee is already assigned to another job on this date.");
    }
    if ((conflictChecks[1].data ?? []).length > 0) {
      warnings.push("Equipment is already assigned to another job on this date.");
    }

    const insertResult = await supabase
      .from("schedule_assignments")
      .insert({
        company_id: companyId,
        job_id: payload.jobId,
        date: payload.date,
        employee_id: payload.employeeId ?? null,
        equipment_id: payload.equipmentId ?? null,
        notes: payload.notes ?? "",
        created_by: access.userId,
      })
      .select("id, job_id, date, employee_id, equipment_id, notes, created_by, created_at")
      .single();

    if (insertResult.error || !insertResult.data) {
      return NextResponse.json({ error: insertResult.error?.message ?? "Failed to create assignment" }, { status: 400 });
    }

    const recipientUserIds = new Set<string>([access.userId]);
    const employeeUserId = (employeeResult.data as { id?: string; user_id?: string } | null)?.user_id;
    if (employeeUserId) {
      recipientUserIds.add(String(employeeUserId));
    }

    await enqueueNotifications({
      supabase,
      companyId,
      userIds: Array.from(recipientUserIds),
      type: "assignment_created",
      payload: {
        assignmentId: insertResult.data.id,
        jobId: payload.jobId,
        jobName: (jobResult.data as { id: string; name?: string }).name ?? "Job",
        date: payload.date,
        href: `/jobs/${payload.jobId}`,
        employeeId: payload.employeeId ?? null,
        equipmentId: payload.equipmentId ?? null,
      },
    });

    const item = mapAssignment(insertResult.data as unknown as Record<string, unknown>);
    return NextResponse.json(warnings.length > 0 ? { item, warnings } : { item });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
