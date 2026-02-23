import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getEffectiveRole } from "@/lib/auth/effectiveRole";
import { type AppRole } from "@/lib/nav/config";

const querySchema = z.object({
  start: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

function isMissingTable(message: string, table: string) {
  const normalized = message.toLowerCase();
  return normalized.includes(table) && (normalized.includes("does not exist") || normalized.includes("not find"));
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

type AssignmentRow = {
  id: string;
  job_id: string;
  date: string;
  employee_id: string | null;
  equipment_id: string | null;
  notes: string | null;
  starts_at: string | null;
  ends_at: string | null;
  created_by: string;
  created_at: string;
};

type JobRow = {
  id: string;
  name: string | null;
  status: string | null;
};

type EmployeeRow = {
  id: string;
  user_id: string | null;
  email: string | null;
};

type EventRow = {
  id: string;
  title: string;
  description: string | null;
  location_text: string | null;
  starts_at: string;
  ends_at: string;
  event_type: string;
  visibility: string;
  created_by: string;
  created_at: string;
};

type EventAttendeeRow = {
  event_id: string;
  attendee_type: string;
  user_id: string | null;
  employee_id: string | null;
  external_name: string | null;
  external_contact: string | null;
  response_status: string;
};

const mapAssignment = (row: AssignmentRow) => ({
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

const mapEvent = (event: EventRow, attendees: EventAttendeeRow[]) => ({
  id: event.id,
  title: event.title,
  description: event.description ?? "",
  locationText: event.location_text ?? "",
  startsAt: event.starts_at,
  endsAt: event.ends_at,
  eventType: event.event_type,
  visibility: event.visibility,
  createdBy: event.created_by,
  createdAt: event.created_at,
  attendees: attendees.map((attendee) => ({
    attendeeType: attendee.attendee_type,
    userId: attendee.user_id,
    employeeId: attendee.employee_id,
    externalName: attendee.external_name,
    externalContact: attendee.external_contact,
    responseStatus: attendee.response_status,
  })),
});

function assignmentVisibleForRole(
  role: AppRole,
  assignment: AssignmentRow,
  employeeRoleById: Map<string, AppRole | null>
) {
  if (role === "admin" || role === "pm") return true;
  if (role === "mechanic") {
    if (assignment.equipment_id) return true;
    if (!assignment.employee_id) return false;
    return employeeRoleById.get(String(assignment.employee_id)) === "mechanic";
  }
  if (!assignment.employee_id) return false;
  return employeeRoleById.get(String(assignment.employee_id)) === role;
}

function eventVisibleForRole(
  role: AppRole,
  event: EventRow,
  attendees: EventAttendeeRow[],
  userId: string,
  userEmployeeIds: Set<string>
) {
  if (event.visibility === "private") {
    return String(event.created_by) === String(userId);
  }
  if (role === "admin" || role === "pm") return true;
  if (event.visibility === "company") return true;
  return attendees.some((attendee) => {
    if (attendee.attendee_type === "user") {
      return String(attendee.user_id ?? "") === String(userId);
    }
    if (attendee.attendee_type === "employee" && attendee.employee_id) {
      return userEmployeeIds.has(String(attendee.employee_id));
    }
    return false;
  });
}

const normalizeEmail = (email: string | null | undefined) => String(email ?? "").trim().toLowerCase();

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

    const weekDays = Array.from({ length: 7 }, (_, index) => {
      const next = new Date(weekStart);
      next.setUTCDate(weekStart.getUTCDate() + index);
      return asDateKey(next);
    });
    const weekEnd = weekDays[6];

    const { supabase, companyId, userId } = await getCompanyId();
    const role = await getEffectiveRole();
    if (!role) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [jobsResult, assignmentsResult, employeesResult, eventsResult, authUserResult] = await Promise.all([
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
      supabase
        .from("employees")
        .select("id, user_id, email, role")
        .eq("company_id", companyId),
      supabase
        .from("calendar_events")
        .select("id, title, description, location_text, starts_at, ends_at, event_type, visibility, created_by, created_at")
        .eq("company_id", companyId)
        .gte("starts_at", `${weekDays[0]}T00:00:00Z`)
        .lte("starts_at", `${weekEnd}T23:59:59Z`)
        .order("starts_at", { ascending: true }),
      supabase.auth.getUser(),
    ]);

    if (jobsResult.error) return NextResponse.json({ error: jobsResult.error.message }, { status: 400 });
    if (assignmentsResult.error && !isMissingTable(assignmentsResult.error.message, "schedule_assignments")) {
      return NextResponse.json({ error: assignmentsResult.error.message }, { status: 400 });
    }
    if (employeesResult.error && !isMissingTable(employeesResult.error.message, "employees")) {
      return NextResponse.json({ error: employeesResult.error.message }, { status: 400 });
    }
    if (eventsResult.error && !isMissingTable(eventsResult.error.message, "calendar_events")) {
      return NextResponse.json({ error: eventsResult.error.message }, { status: 400 });
    }

    const employees = (employeesResult.data ?? []) as Array<EmployeeRow & { role: string | null }>;
    const employeeRoleById = new Map<string, AppRole | null>();
    for (const employee of employees) {
      const roleValue = String(employee.role ?? "").toLowerCase();
      const normalizedRole: AppRole | null =
        roleValue.includes("admin") || roleValue.includes("ceo")
          ? "admin"
          : roleValue === "pm" || roleValue.includes("project")
            ? "pm"
            : roleValue.includes("foreman")
              ? "foreman"
              : roleValue.includes("mechanic")
                ? "mechanic"
                : roleValue.includes("operator")
                  ? "operator"
                  : null;
      employeeRoleById.set(String(employee.id), normalizedRole);
    }

    const authEmail = normalizeEmail(authUserResult.data?.user?.email);
    const userEmployeeIds = new Set<string>();
    for (const employee of employees) {
      if (String(employee.user_id ?? "") === String(userId)) {
        userEmployeeIds.add(String(employee.id));
        continue;
      }
      if (authEmail && normalizeEmail(employee.email) === authEmail) {
        userEmployeeIds.add(String(employee.id));
      }
    }

    const assignments = ((assignmentsResult.data ?? []) as AssignmentRow[])
      .filter((assignment) => assignmentVisibleForRole(role, assignment, employeeRoleById))
      .map(mapAssignment);

    const eventRows = (eventsResult.data ?? []) as EventRow[];
    const attendeeRowsResult =
      eventRows.length === 0
        ? { data: [], error: null }
        : await supabase
            .from("calendar_event_attendees")
            .select("event_id, attendee_type, user_id, employee_id, external_name, external_contact, response_status")
            .eq("company_id", companyId)
            .in("event_id", eventRows.map((event) => event.id));

    if (attendeeRowsResult.error && !isMissingTable(attendeeRowsResult.error.message, "calendar_event_attendees")) {
      return NextResponse.json({ error: attendeeRowsResult.error.message }, { status: 400 });
    }

    const attendeesByEvent = new Map<string, EventAttendeeRow[]>();
    for (const attendee of (attendeeRowsResult.data ?? []) as EventAttendeeRow[]) {
      const list = attendeesByEvent.get(attendee.event_id) ?? [];
      list.push(attendee);
      attendeesByEvent.set(attendee.event_id, list);
    }

    const events = eventRows
      .filter((event) => eventVisibleForRole(role, event, attendeesByEvent.get(event.id) ?? [], userId, userEmployeeIds))
      .map((event) => mapEvent(event, attendeesByEvent.get(event.id) ?? []));

    const visibleJobIds = new Set(assignments.map((assignment) => String(assignment.jobId)));
    const jobs = ((jobsResult.data ?? []) as JobRow[])
      .filter((job) => role === "admin" || role === "pm" || visibleJobIds.has(String(job.id)))
      .map((job) => ({
        id: String(job.id),
        title: String(job.name ?? "Untitled Job"),
        status: String(job.status ?? ""),
        href: `/jobs/${job.id}`,
      }));

    return NextResponse.json({
      items: {
        assignments,
        events,
        jobs,
      },
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
