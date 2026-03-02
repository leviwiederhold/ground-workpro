import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getEffectiveRole } from "@/lib/auth/effectiveRole";
import { listFallbackEventsForWeek } from "@/lib/calendar/fallbackStore";

const querySchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

function isMissingCalendarTables(message: string) {
  const normalized = message.toLowerCase();
  const referencesCalendarTables =
    normalized.includes("calendar_events") || normalized.includes("calendar_event_attendees");
  return referencesCalendarTables && (normalized.includes("does not exist") || normalized.includes("not find"));
}

function isMissingEmployeesTable(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("employees") && (normalized.includes("does not exist") || normalized.includes("not find"));
}

const asDateKey = (date: Date) => date.toISOString().slice(0, 10);

const getWeekDays = (start: Date) =>
  Array.from({ length: 7 }, (_, index) => {
    const next = new Date(start);
    next.setUTCDate(start.getUTCDate() + index);
    return asDateKey(next);
  });

type CalendarEventRow = {
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

type CalendarAttendeeRow = {
  event_id: string;
  attendee_type: string;
  user_id: string | null;
  employee_id: string | null;
  external_name: string | null;
  external_contact: string | null;
  response_status: string;
};

type EmployeeRow = {
  id: string;
  user_id: string | null;
  email: string | null;
};

const mapEvent = (event: CalendarEventRow, attendees: CalendarAttendeeRow[]) => ({
  id: event.id,
  title: event.title,
  startsAt: event.starts_at,
  endsAt: event.ends_at,
  locationText: event.location_text ?? "",
  eventType: event.event_type,
  visibility: event.visibility,
  attendeesCount: attendees.length,
});

const normalizeEmail = (email: string | null | undefined) => String(email ?? "").trim().toLowerCase();

async function resolveUserEmployeeIds(
  supabase: Awaited<ReturnType<typeof getCompanyId>>["supabase"],
  companyId: string,
  userId: string,
  currentUserEmail: string
) {
  const userEmail = normalizeEmail(currentUserEmail);

  const employeesResult = await supabase.from("employees").select("*").eq("company_id", companyId);
  const employeesError = employeesResult.error;
  const employeesData = ((employeesResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id ?? ""),
    email: row.email ? String(row.email) : null,
    user_id: row.user_id ? String(row.user_id) : null,
  })) as EmployeeRow[];

  if (employeesError) {
    if (isMissingEmployeesTable(employeesError.message)) {
      return { ids: new Set<string>(), error: null };
    }
    return { ids: new Set<string>(), error: employeesError.message };
  }

  const ids = new Set<string>();
  for (const employee of employeesData) {
    if (String(employee.user_id ?? "") === String(userId)) {
      ids.add(String(employee.id));
      continue;
    }
    if (userEmail && normalizeEmail(employee.email) === userEmail) {
      ids.add(String(employee.id));
    }
  }

  return { ids, error: null as string | null };
}

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsedQuery = querySchema.safeParse({
      start: url.searchParams.get("start"),
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

    const weekStart = new Date(`${parsedQuery.data.start}T00:00:00Z`);
    if (Number.isNaN(weekStart.getTime())) {
      return NextResponse.json({ error: "Validation error", details: [{ path: "start", message: "Invalid date" }] }, { status: 422 });
    }

    const { supabase, companyId, userId, userEmail } = await getCompanyId();
    const effectiveRole = await getEffectiveRole();
    if (!effectiveRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const weekDays = getWeekDays(weekStart);
    const weekEnd = weekDays[6];

    const eventsResult = await supabase
      .from("calendar_events")
      .select("id, title, description, location_text, starts_at, ends_at, event_type, visibility, created_by, created_at")
      .eq("company_id", companyId)
      .gte("starts_at", `${weekDays[0]}T00:00:00Z`)
      .lte("starts_at", `${weekEnd}T23:59:59Z`)
      .order("starts_at", { ascending: true });

    if (eventsResult.error) {
      if (isMissingCalendarTables(eventsResult.error.message)) {
        const userEmployeeIdsResult = await resolveUserEmployeeIds(supabase, companyId, userId, userEmail);
        if (userEmployeeIdsResult.error) {
          return NextResponse.json({ error: userEmployeeIdsResult.error }, { status: 400 });
        }
        const userEmployeeIds = userEmployeeIdsResult.ids;

        const fallbackItems = listFallbackEventsForWeek(companyId, weekDays[0], weekEnd)
          .filter((event) => {
            if (event.visibility === "private") return String(event.created_by) === String(userId);
            if (effectiveRole === "admin" || effectiveRole === "pm") return true;
            if (event.visibility === "company") return true;
            return event.attendees.some((attendee) => {
              if (attendee.attendee_type === "user") {
                return String(attendee.user_id ?? "") === String(userId) && String(attendee.response_status ?? "invited") !== "declined";
              }
              if (attendee.attendee_type === "employee" && attendee.employee_id) {
                return (
                  userEmployeeIds.has(String(attendee.employee_id)) &&
                  String(attendee.response_status ?? "invited") !== "declined"
                );
              }
              return false;
            });
          })
          .map((event) => ({
            id: event.id,
            title: event.title,
            startsAt: event.starts_at,
            endsAt: event.ends_at,
            locationText: event.location_text ?? "",
            eventType: event.event_type,
            visibility: event.visibility,
            attendeesCount: event.attendees.length,
          }));
        return NextResponse.json({ items: fallbackItems });
      }
      return NextResponse.json({ error: eventsResult.error.message }, { status: 400 });
    }

    const allEvents = (eventsResult.data ?? []) as CalendarEventRow[];
    if (allEvents.length === 0) return NextResponse.json({ items: [] });

    const attendeesResult = await supabase
      .from("calendar_event_attendees")
      .select("event_id, attendee_type, user_id, employee_id, external_name, external_contact, response_status")
      .eq("company_id", companyId)
      .in("event_id", allEvents.map((event) => event.id));

    if (attendeesResult.error) {
      if (isMissingCalendarTables(attendeesResult.error.message)) {
        return NextResponse.json({
          items: allEvents
            .filter((event) => event.visibility !== "private" || String(event.created_by) === String(userId))
            .map((event) => mapEvent(event, [])),
        });
      }
      return NextResponse.json({ error: attendeesResult.error.message }, { status: 400 });
    }

    const attendeeRows = (attendeesResult.data ?? []) as CalendarAttendeeRow[];
    const attendeesByEvent = new Map<string, CalendarAttendeeRow[]>();
    for (const attendee of attendeeRows) {
      const list = attendeesByEvent.get(attendee.event_id) ?? [];
      list.push(attendee);
      attendeesByEvent.set(attendee.event_id, list);
    }

    const userEmployeeIdsResult = await resolveUserEmployeeIds(supabase, companyId, userId, userEmail);
    if (userEmployeeIdsResult.error) {
      return NextResponse.json({ error: userEmployeeIdsResult.error }, { status: 400 });
    }
    const userEmployeeIds = userEmployeeIdsResult.ids;

    const visibleEvents = allEvents.filter((event) => {
      if (event.visibility === "private") {
        return String(event.created_by) === String(userId);
      }
      if (effectiveRole === "admin" || effectiveRole === "pm") return true;
      if (event.visibility === "company") return true;
      const attendees = attendeesByEvent.get(event.id) ?? [];
      return attendees.some((attendee) => {
        if (attendee.attendee_type === "user") {
          return String(attendee.user_id ?? "") === String(userId) && String(attendee.response_status ?? "invited") !== "declined";
        }
        if (attendee.attendee_type === "employee" && attendee.employee_id) {
          return userEmployeeIds.has(String(attendee.employee_id)) && String(attendee.response_status ?? "invited") !== "declined";
        }
        return false;
      });
    });

    const items = visibleEvents.map((event) => mapEvent(event, attendeesByEvent.get(event.id) ?? []));
    return NextResponse.json({ items });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
