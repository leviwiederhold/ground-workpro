import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getEffectiveRole } from "@/lib/auth/effectiveRole";

const querySchema = z.object({
  start: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

function isMissingScheduleAssignmentsTable(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("schedule_assignments") && (normalized.includes("does not exist") || normalized.includes("not find"));
}

const JOB_SCHEDULE_STATUSES = ["active", "open", "in_progress", "approved", "draft"];

const asDateKey = (date: Date) => date.toISOString().slice(0, 10);

const getWeekStart = (rawStart?: string) => {
  const base = rawStart ? new Date(`${rawStart}T00:00:00Z`) : new Date();
  if (Number.isNaN(base.getTime())) return null;
  const day = base.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(base);
  monday.setUTCDate(base.getUTCDate() + diff);
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
};

const getWeekDays = (start: Date) =>
  Array.from({ length: 7 }, (_, index) => {
    const next = new Date(start);
    next.setUTCDate(start.getUTCDate() + index);
    return asDateKey(next);
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

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsedQuery = querySchema.safeParse({
      start: url.searchParams.get("start") ?? undefined,
    });
    if (!parsedQuery.success) {
      return NextResponse.json(
        {
          error: "Validation error",
          details: parsedQuery.error.issues.map((issue: { path: (string | number)[]; message: string }) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 422 }
      );
    }

    const weekStart = getWeekStart(parsedQuery.data.start);
    if (!weekStart) {
      return NextResponse.json({ error: "Validation error", details: [{ path: "start", message: "Invalid date" }] }, { status: 422 });
    }

    const weekDays = getWeekDays(weekStart);
    const weekEnd = weekDays[6];

    const { supabase, companyId } = await getCompanyId();
    const effectiveRole = await getEffectiveRole();
    if (!effectiveRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (effectiveRole === "operator") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [jobsResult, assignmentsResult] = await Promise.all([
      supabase
        .from("jobs")
        .select("id, name, status")
        .eq("company_id", companyId)
        .in("status", JOB_SCHEDULE_STATUSES)
        .order("name", { ascending: true }),
      supabase
        .from("schedule_assignments")
        .select("id, job_id, date, employee_id, equipment_id, starts_at, ends_at, notes, created_by, created_at")
        .eq("company_id", companyId)
        .gte("date", weekDays[0])
        .lte("date", weekEnd)
        .order("created_at", { ascending: true }),
    ]);

    if (jobsResult.error) {
      return NextResponse.json({ error: jobsResult.error.message }, { status: 400 });
    }
    if (assignmentsResult.error) {
      if (isMissingScheduleAssignmentsTable(assignmentsResult.error.message)) {
        const jobs = (jobsResult.data ?? []).map((job) => ({
          id: String(job.id),
          title: String(job.name ?? "Untitled Job"),
          status: String(job.status ?? ""),
          href: `/jobs/${job.id}`,
        }));
        return NextResponse.json({
          items: weekDays.map((date) => ({
            date,
            jobs,
            assignments: [],
          })),
        });
      }
      return NextResponse.json({ error: assignmentsResult.error.message }, { status: 400 });
    }

    const jobs = (jobsResult.data ?? []).map((job) => ({
      id: String(job.id),
      title: String(job.name ?? "Untitled Job"),
      status: String(job.status ?? ""),
      href: `/jobs/${job.id}`,
    }));

    const assignmentsByDate = new Map<string, ReturnType<typeof mapAssignment>[]>();
    for (const row of assignmentsResult.data ?? []) {
      const assignment = mapAssignment(row as unknown as Record<string, unknown>);
      const list = assignmentsByDate.get(assignment.date) ?? [];
      list.push(assignment);
      assignmentsByDate.set(assignment.date, list);
    }

    const items = weekDays.map((date) => ({
      date,
      jobs,
      assignments: assignmentsByDate.get(date) ?? [],
    }));

    return NextResponse.json({ items });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
