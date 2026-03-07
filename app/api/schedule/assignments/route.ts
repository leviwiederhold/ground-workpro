import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { getEffectiveRole } from "@/lib/auth/effectiveRole";
import { enqueueNotifications } from "@/lib/notifications/enqueue";
import { createFallbackAssignment, listFallbackAssignmentsForDate } from "@/lib/schedule/fallbackStore";

const createAssignmentSchema = z
  .object({
    jobId: z.string().uuid(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    employeeId: z.string().uuid().optional(),
    equipmentId: z.string().uuid().optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
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
  startsAt: row.starts_at ? String(row.starts_at) : null,
  endsAt: row.ends_at ? String(row.ends_at) : null,
  notes: row.notes ? String(row.notes) : "",
  createdBy: row.created_by ? String(row.created_by) : "",
  createdAt: row.created_at ? String(row.created_at) : "",
});

const isMissingScheduleAssignmentsTable = (message: string | undefined) =>
  /Could not find the table 'public\.schedule_assignments'|relation .*schedule_assignments.* does not exist/i.test(
    message ?? ""
  );

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    let access: Awaited<ReturnType<typeof requireRole>>;
    try {
      access = await requireRole(["admin", "pm", "foreman"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const effectiveRole = await getEffectiveRole();
    if (!effectiveRole || !["admin", "pm", "foreman"].includes(effectiveRole)) {
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

    if ((payload.startsAt && !payload.endsAt) || (!payload.startsAt && payload.endsAt)) {
      return NextResponse.json({ error: "startsAt and endsAt required together" }, { status: 400 });
    }

    if (payload.startsAt && payload.endsAt) {
      const startsAtDate = new Date(payload.startsAt);
      const endsAtDate = new Date(payload.endsAt);
      if (Number.isNaN(startsAtDate.getTime()) || Number.isNaN(endsAtDate.getTime())) {
        return NextResponse.json({ error: "Invalid startsAt or endsAt" }, { status: 400 });
      }
      if (endsAtDate <= startsAtDate) {
        return NextResponse.json({ error: "endsAt must be after startsAt" }, { status: 400 });
      }
    }

    const checks = [
      supabase.from("jobs").select("id, name").eq("company_id", companyId).eq("id", payload.jobId).maybeSingle(),
      payload.employeeId
        ? supabase
            .from("employees")
            .select("*")
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
    const duplicateCheck =
      payload.employeeId && payload.jobId
        ? await supabase
            .from("schedule_assignments")
            .select("id")
            .eq("company_id", companyId)
            .eq("date", payload.date)
            .eq("employee_id", payload.employeeId)
            .eq("job_id", payload.jobId)
            .limit(1)
        : { data: [], error: null };

    if (duplicateCheck.error && !isMissingScheduleAssignmentsTable(duplicateCheck.error.message)) {
      return NextResponse.json({ error: duplicateCheck.error.message }, { status: 400 });
    }
    if (!duplicateCheck.error && (duplicateCheck.data ?? []).length > 0) {
      return NextResponse.json({ error: "Already assigned" }, { status: 409 });
    }

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

    if (conflictChecks[0].error && !isMissingScheduleAssignmentsTable(conflictChecks[0].error.message)) {
      return NextResponse.json({ error: conflictChecks[0].error.message }, { status: 400 });
    }
    if (conflictChecks[1].error && !isMissingScheduleAssignmentsTable(conflictChecks[1].error.message)) {
      return NextResponse.json({ error: conflictChecks[1].error.message }, { status: 400 });
    }
    if (!conflictChecks[0].error && (conflictChecks[0].data ?? []).length > 0) {
      warnings.push("Employee is already assigned to another job on this date.");
    }
    if (!conflictChecks[1].error && (conflictChecks[1].data ?? []).length > 0) {
      warnings.push("Equipment is already assigned to another job on this date.");
    }
    if (conflictChecks[0].error && isMissingScheduleAssignmentsTable(conflictChecks[0].error.message)) {
      const fallbackConflicts = listFallbackAssignmentsForDate(companyId, payload.date).filter(
        (row) => row.employee_id === (payload.employeeId ?? null) && row.job_id !== payload.jobId
      );
      if (fallbackConflicts.length > 0) {
        warnings.push("Employee is already assigned to another job on this date.");
      }
    }
    if (conflictChecks[1].error && isMissingScheduleAssignmentsTable(conflictChecks[1].error.message)) {
      const fallbackConflicts = listFallbackAssignmentsForDate(companyId, payload.date).filter(
        (row) => row.equipment_id === (payload.equipmentId ?? null) && row.job_id !== payload.jobId
      );
      if (fallbackConflicts.length > 0) {
        warnings.push("Equipment is already assigned to another job on this date.");
      }
    }

    const insertResult = await supabase
      .from("schedule_assignments")
      .insert({
        company_id: companyId,
        job_id: payload.jobId,
        date: payload.date,
        employee_id: payload.employeeId ?? null,
        equipment_id: payload.equipmentId ?? null,
        starts_at: payload.startsAt ?? null,
        ends_at: payload.endsAt ?? null,
        notes: payload.notes ?? "",
        created_by: access.userId,
      })
      .select("id, job_id, date, employee_id, equipment_id, starts_at, ends_at, notes, created_by, created_at")
      .single();

    if (insertResult.error && isMissingScheduleAssignmentsTable(insertResult.error.message)) {
      if (payload.employeeId) {
        const jobEmployeeInsert = await supabase
          .from("job_employees")
          .insert({
            company_id: companyId,
            job_id: payload.jobId,
            employee_id: payload.employeeId,
          })
          .select("employee_id")
          .maybeSingle();
        if (jobEmployeeInsert.error && !/duplicate key|unique/i.test(jobEmployeeInsert.error.message || "")) {
          return NextResponse.json({ error: jobEmployeeInsert.error?.message ?? "Failed to create assignment" }, { status: 400 });
        }
      }
      if (payload.equipmentId) {
        const jobEquipmentInsert = await supabase
          .from("job_equipment")
          .insert({
            company_id: companyId,
            job_id: payload.jobId,
            equipment_id: payload.equipmentId,
          })
          .select("equipment_id")
          .maybeSingle();
        if (jobEquipmentInsert.error && !/duplicate key|unique/i.test(jobEquipmentInsert.error.message || "")) {
          return NextResponse.json({ error: jobEquipmentInsert.error?.message ?? "Failed to create assignment" }, { status: 400 });
        }
      }
      const fallbackAssignment = createFallbackAssignment({
        company_id: companyId,
        job_id: payload.jobId,
        date: payload.date,
        employee_id: payload.employeeId ?? null,
        equipment_id: payload.equipmentId ?? null,
        starts_at: payload.startsAt ?? null,
        ends_at: payload.endsAt ?? null,
        notes: payload.notes ?? "",
        created_by: access.userId,
      });
      const fallbackItem = {
        id: fallbackAssignment.id,
        jobId: payload.jobId,
        date: payload.date,
        employeeId: payload.employeeId ?? null,
        equipmentId: payload.equipmentId ?? null,
        startsAt: payload.startsAt ?? null,
        endsAt: payload.endsAt ?? null,
        notes: payload.notes ?? "",
        createdBy: access.userId,
        createdAt: fallbackAssignment.created_at,
      };

      const fallbackRecipientUserIds = new Set<string>([access.userId]);
      const fallbackEmployeeUserId = (employeeResult.data as { id?: string; user_id?: string } | null)?.user_id;
      if (fallbackEmployeeUserId) {
        fallbackRecipientUserIds.add(String(fallbackEmployeeUserId));
      }
      await enqueueNotifications({
        supabase,
        companyId,
        userIds: Array.from(fallbackRecipientUserIds),
        type: "assignment_created",
        payload: {
          assignmentId: fallbackAssignment.id,
          jobId: payload.jobId,
          jobName: (jobResult.data as { id: string; name?: string }).name ?? "Job",
          date: payload.date,
          href: `/jobs/${payload.jobId}`,
          employeeId: payload.employeeId ?? null,
          equipmentId: payload.equipmentId ?? null,
        },
      });

      return NextResponse.json(warnings.length > 0 ? { item: fallbackItem, warnings } : { item: fallbackItem });
    }

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
    createFallbackAssignment({
      company_id: companyId,
      job_id: payload.jobId,
      date: payload.date,
      employee_id: payload.employeeId ?? null,
      equipment_id: payload.equipmentId ?? null,
      starts_at: payload.startsAt ?? null,
      ends_at: payload.endsAt ?? null,
      notes: payload.notes ?? "",
      created_by: access.userId,
    });
    return NextResponse.json(warnings.length > 0 ? { item, warnings } : { item });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
