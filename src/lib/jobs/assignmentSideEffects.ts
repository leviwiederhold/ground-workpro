/* eslint-disable @typescript-eslint/no-explicit-any */
import { enqueueNotifications } from "@/lib/notifications/enqueue";

export async function runJobAssignmentSideEffects(params: {
  supabase: any;
  companyId: string;
  actorUserId: string;
  employee: Record<string, any>;
  job: Record<string, any>;
  previousJobId?: string | null;
}) {
  const { supabase, companyId, actorUserId, employee, job, previousJobId } = params;
  const employeeId = String(employee.id);
  const jobId = String(job.id);
  const employeeUserId = String(employee.user_id ?? "").trim();

  if (employeeUserId) {
    try {
      await enqueueNotifications({
        supabase,
        companyId,
        userIds: [employeeUserId],
        type: "job_assigned",
        payload: {
          jobId,
          jobName: String(job.name ?? "Assigned Job"),
          date: new Date().toISOString().slice(0, 10),
          href: "/schedule",
        },
      });
    } catch {
      // The authoritative membership is already committed; notifications are
      // intentionally best-effort, matching the existing assignment workflow.
    }
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    if (previousJobId) {
      await supabase
        .from("schedule_assignments")
        .delete()
        .eq("company_id", companyId)
        .eq("job_id", previousJobId)
        .eq("employee_id", employeeId)
        .eq("date", today);
    }

    const existingSchedule = await supabase
      .from("schedule_assignments")
      .select("id")
      .eq("company_id", companyId)
      .eq("job_id", jobId)
      .eq("employee_id", employeeId)
      .eq("date", today)
      .limit(1);

    if (!existingSchedule.error && (existingSchedule.data ?? []).length === 0) {
      await supabase.from("schedule_assignments").insert({
        company_id: companyId,
        job_id: jobId,
        employee_id: employeeId,
        date: today,
        created_by: actorUserId,
        notes: previousJobId
          ? "Auto-moved from job reassignment"
          : "Auto-added from job assignment",
      });
    }
  } catch {
    // Scheduling is a convenience mirror; it must not turn a committed atomic
    // crew assignment into an apparent API failure.
  }
}
