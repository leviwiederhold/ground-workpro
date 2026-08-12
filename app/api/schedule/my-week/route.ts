import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getEffectiveRole } from "@/lib/auth/effectiveRole";
import { normalizeAppRole, type AppRole } from "@/lib/nav/config";
import { listFallbackEventsForWeek } from "@/lib/calendar/fallbackStore";
import { listFallbackAssignmentsForWeek } from "@/lib/schedule/fallbackStore";

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

type FallbackEvent = {
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
  attendees: EventAttendeeRow[];
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

type JobEmployeeRow = {
  job_id: string;
  employee_id: string;
  created_at?: string | null;
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
  employeeRoleById: Map<string, AppRole | null>,
  userEmployeeIds: Set<string>,
  hasLinkedEmployeeForRole: boolean
) {
  if (role === "admin" || role === "pm") return true;
  if (assignment.employee_id && userEmployeeIds.has(String(assignment.employee_id))) {
    return true;
  }
  if (hasLinkedEmployeeForRole) {
    return false;
  }
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
  userEmployeeIds: Set<string>,
  employeeRoleById: Map<string, AppRole | null>,
  hasLinkedEmployeeForRole: boolean
) {
  if (event.visibility === "private") {
    return String(event.created_by) === String(userId);
  }
  if (event.visibility === "company") return true;
  if (String(event.created_by) === String(userId)) return true;
  return attendees.some((attendee) => {
    if (attendee.attendee_type === "user") {
      return String(attendee.user_id ?? "") === String(userId) && String(attendee.response_status ?? "invited") !== "declined";
    }
    if (attendee.attendee_type === "employee" && attendee.employee_id) {
      const employeeId = String(attendee.employee_id);
      if (String(attendee.response_status ?? "invited") === "declined") return false;
      if (userEmployeeIds.has(employeeId)) return true;
      if (hasLinkedEmployeeForRole) return false;
      return employeeRoleById.get(employeeId) === role;
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
    const weekStartIso = `${weekDays[0]}T00:00:00Z`;
    const weekEndExclusiveDate = new Date(`${weekEnd}T00:00:00Z`);
    weekEndExclusiveDate.setUTCDate(weekEndExclusiveDate.getUTCDate() + 1);
    const weekEndExclusiveIso = `${asDateKey(weekEndExclusiveDate)}T00:00:00Z`;

    const { supabase, companyId, userId, userEmail } = await getCompanyId();
    const role = await getEffectiveRole();
    if (!role) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [jobsResult, assignmentsResult, employeesResult, eventsResult] = await Promise.all([
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
      supabase.from("employees").select("*").eq("company_id", companyId),
      supabase
        .from("calendar_events")
        .select("id, title, description, location_text, starts_at, ends_at, event_type, visibility, created_by, created_at")
        .eq("company_id", companyId)
        // Include events that overlap the week even if they start earlier.
        .lt("starts_at", weekEndExclusiveIso)
        .gt("ends_at", weekStartIso)
        .order("starts_at", { ascending: true }),
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

    const fallbackEvents: FallbackEvent[] =
      eventsResult.error && isMissingTable(eventsResult.error.message, "calendar_events")
        ? listFallbackEventsForWeek(companyId, weekDays[0], weekEnd).map((event) => ({
            id: event.id,
            title: event.title,
            description: event.description ?? "",
            location_text: event.location_text ?? "",
            starts_at: event.starts_at,
            ends_at: event.ends_at,
            event_type: event.event_type,
            visibility: event.visibility,
            created_by: event.created_by,
            created_at: event.created_at,
            attendees: event.attendees.map((attendee) => ({
              event_id: event.id,
              attendee_type: attendee.attendee_type,
              user_id: attendee.user_id,
              employee_id: attendee.employee_id,
              external_name: attendee.external_name,
              external_contact: attendee.external_contact,
              response_status: attendee.response_status,
            })),
          }))
        : [];

    const employees = ((employeesResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id ?? ""),
      user_id: row.user_id ? String(row.user_id) : null,
      email: row.email ? String(row.email) : null,
      role: row.role ? String(row.role) : null,
      legacy_permission_profile: row.legacy_permission_profile ? String(row.legacy_permission_profile) : null,
      name: row.name ? String(row.name) : null,
      full_name: row.full_name ? String(row.full_name) : null,
    }));
    const employeeRoleById = new Map<string, AppRole | null>();
    for (const employee of employees) {
      const normalizedRole = normalizeAppRole(
        employee.role,
        employee.legacy_permission_profile
      );
      employeeRoleById.set(String(employee.id), normalizedRole);
    }

    const authEmail = normalizeEmail(userEmail);
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
    const hasLinkedEmployeeForRole = Array.from(userEmployeeIds).some(
      (employeeId) => employeeRoleById.get(employeeId) === role
    );

    let assignmentRows = ((assignmentsResult.data ?? []) as AssignmentRow[]);
    if (assignmentsResult.error && isMissingTable(assignmentsResult.error.message, "schedule_assignments")) {
      const jobEmployeeAssignments = await supabase
        .from("job_employees")
        .select("job_id, employee_id, created_at")
        .eq("company_id", companyId)
        .limit(500);
      if (jobEmployeeAssignments.error && !isMissingTable(jobEmployeeAssignments.error.message ?? "", "job_employees")) {
        return NextResponse.json({ error: jobEmployeeAssignments.error.message ?? "Failed to load job assignments" }, { status: 400 });
      }
      assignmentRows = (jobEmployeeAssignments.data ?? []).map((row) => ({
        id: `job-employee-${String(row.job_id)}-${String(row.employee_id)}`,
        job_id: String(row.job_id),
        date: weekDays[0],
        employee_id: String(row.employee_id),
        equipment_id: null,
        notes: null,
        starts_at: null,
        ends_at: null,
        created_by: userId,
        created_at: String(row.created_at ?? new Date().toISOString()),
      }));
    }

    const jobEmployeesResult = await supabase
      .from("job_employees")
      .select("job_id, employee_id, created_at")
      .eq("company_id", companyId)
      .limit(500);
    if (jobEmployeesResult.error && !isMissingTable(jobEmployeesResult.error.message ?? "", "job_employees")) {
      return NextResponse.json({ error: jobEmployeesResult.error.message ?? "Failed to load job assignments" }, { status: 400 });
    }

    const mergedAssignments = [...assignmentRows];
    const assignmentKeys = new Set(
      assignmentRows.map((row) => `${String(row.job_id)}::${String(row.employee_id ?? "")}::${String(row.date)}`)
    );
    for (const row of (jobEmployeesResult.data ?? []) as JobEmployeeRow[]) {
      const syntheticDate = weekDays[0];
      const key = `${String(row.job_id)}::${String(row.employee_id)}::${syntheticDate}`;
      if (assignmentKeys.has(key)) continue;
      mergedAssignments.push({
        id: `job-employee-${String(row.job_id)}-${String(row.employee_id)}`,
        job_id: String(row.job_id),
        date: syntheticDate,
        employee_id: String(row.employee_id),
        equipment_id: null,
        notes: "Linked from Team assignment",
        starts_at: null,
        ends_at: null,
        created_by: userId,
        created_at: String(row.created_at ?? new Date().toISOString()),
      });
      assignmentKeys.add(key);
    }
    for (const row of listFallbackAssignmentsForWeek(companyId, weekDays[0], weekEnd)) {
      const key = `${String(row.job_id)}::${String(row.employee_id ?? "")}::${String(row.date)}`;
      if (assignmentKeys.has(key)) continue;
      mergedAssignments.push({
        id: row.id,
        job_id: String(row.job_id),
        date: String(row.date),
        employee_id: row.employee_id ? String(row.employee_id) : null,
        equipment_id: row.equipment_id ? String(row.equipment_id) : null,
        notes: row.notes ?? null,
        starts_at: row.starts_at ?? null,
        ends_at: row.ends_at ?? null,
        created_by: String(row.created_by),
        created_at: String(row.created_at),
      });
      assignmentKeys.add(key);
    }

    const assignments = mergedAssignments
      .filter((assignment) =>
        assignmentVisibleForRole(
          role,
          assignment,
          employeeRoleById,
          userEmployeeIds,
          hasLinkedEmployeeForRole
        )
      )
      .map(mapAssignment);

    const employeeJobResult =
      userEmployeeIds.size === 0 || role === "admin" || role === "pm"
        ? { data: [] as Array<{ id: string; job_id: string | null }>, error: null as { message?: string } | null }
        : await supabase
            .from("employees")
            .select("id, job_id")
            .eq("company_id", companyId)
            .in("id", Array.from(userEmployeeIds))
            .limit(200);
    if (employeeJobResult.error && !isMissingTable(employeeJobResult.error.message ?? "", "employees")) {
      return NextResponse.json({ error: employeeJobResult.error.message ?? "Failed to load employee assignments" }, { status: 400 });
    }

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
    for (const event of fallbackEvents) {
      attendeesByEvent.set(event.id, event.attendees);
    }

    const allEvents = [
      ...eventRows,
      ...fallbackEvents.map((event) => ({
        id: event.id,
        title: event.title,
        description: event.description,
        location_text: event.location_text,
        starts_at: event.starts_at,
        ends_at: event.ends_at,
        event_type: event.event_type,
        visibility: event.visibility,
        created_by: event.created_by,
        created_at: event.created_at,
      })),
    ] as EventRow[];

    const events = allEvents
      .filter((event) =>
        eventVisibleForRole(
          role,
          event,
          attendeesByEvent.get(event.id) ?? [],
          userId,
          userEmployeeIds,
          employeeRoleById,
          hasLinkedEmployeeForRole
        )
      )
      .map((event) => mapEvent(event, attendeesByEvent.get(event.id) ?? []));

    const visibleJobIds = new Set(assignments.map((assignment) => String(assignment.jobId)));
    for (const row of (jobEmployeesResult.data ?? []) as JobEmployeeRow[]) {
      visibleJobIds.add(String(row.job_id));
    }
    for (const row of (employeeJobResult.data ?? []) as Array<{ id: string; job_id: string | null }>) {
      if (row.job_id) visibleJobIds.add(String(row.job_id));
    }
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
