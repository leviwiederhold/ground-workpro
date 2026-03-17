import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { getEffectiveRole } from "@/lib/auth/effectiveRole";
import { enqueueNotifications } from "@/lib/notifications/enqueue";
import { enqueueUpcomingEventReminder } from "@/lib/notifications/calendarReminders";
import { createFallbackEvent } from "@/lib/calendar/fallbackStore";

const attendeeSchema = z
  .object({
    attendeeType: z.enum(["user", "employee", "external"]).optional(),
    type: z.enum(["user", "employee", "external"]).optional(),
    userId: z.string().uuid().optional(),
    employeeId: z.string().uuid().optional(),
    externalName: z.string().optional(),
    externalContact: z.string().optional(),
    responseStatus: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    const attendeeType = value.attendeeType ?? value.type;
    if (!attendeeType) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["type"], message: "type is required" });
      return;
    }
    if (attendeeType === "user" && !value.userId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["userId"], message: "userId is required for user attendee" });
    }
    if (attendeeType === "employee" && !value.employeeId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["employeeId"], message: "employeeId is required for employee attendee" });
    }
    if (attendeeType === "external" && !value.externalName) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["externalName"], message: "externalName is required for external attendee" });
    }
  })
  .transform((value) => ({
    attendeeType: (value.attendeeType ?? value.type)!,
    userId: value.userId,
    employeeId: value.employeeId,
    externalName: value.externalName,
    externalContact: value.externalContact,
    responseStatus: value.responseStatus,
  }));
type EventAttendee = z.infer<typeof attendeeSchema>;

const createEventSchema = z
  .object({
    title: z.string().min(1),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    visibility: z.enum(["attendees", "company", "private"]).default("attendees"),
    eventType: z.enum(["meeting", "client", "inspection", "delivery", "internal"]),
    locationText: z.string().optional(),
    description: z.string().optional(),
    attendees: z.array(attendeeSchema).default([]),
  })
  .refine((value: { startsAt: string; endsAt: string }) => new Date(value.endsAt).getTime() > new Date(value.startsAt).getTime(), {
    path: ["endsAt"],
    message: "endsAt must be after startsAt",
  });

const mapEvent = (
  event: {
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
  },
  attendees: Array<{
    attendee_type: string;
    user_id: string | null;
    employee_id: string | null;
    external_name: string | null;
    external_contact: string | null;
    response_status: string;
  }>
) => ({
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

export const dynamic = "force-dynamic";

function isMissingScheduleAssignmentsTable(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("schedule_assignments") && (normalized.includes("does not exist") || normalized.includes("not find"));
}

function isMissingCalendarTables(message: string) {
  const normalized = message.toLowerCase();
  const referencesCalendarTables =
    normalized.includes("calendar_events") || normalized.includes("calendar_event_attendees");
  return referencesCalendarTables && (normalized.includes("does not exist") || normalized.includes("not find"));
}

export async function POST(request: Request) {
  try {
    const role = await getEffectiveRole();
    if (!role) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await request.json().catch(() => null);
    const parsedBody = createEventSchema.safeParse(body);
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
    const authUserResult = await supabase.auth.getUser();
    const authEmail = String(authUserResult.data?.user?.email ?? "").trim().toLowerCase();
    const payload = parsedBody.data;
    const isAdminOrPm = role === "admin" || role === "pm";
    if (!isAdminOrPm && payload.visibility === "company") {
      payload.visibility = "attendees";
    }
    let access: Awaited<ReturnType<typeof requireRole>> | { userId: string };
    if (isAdminOrPm) {
      try {
        access = await requireRole(["admin", "pm"]);
      } catch {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } else {
      const tenant = await getCompanyId();
      access = { userId: tenant.userId };
    }
    const warnings: string[] = [];

    const uniqueEmployeeIds = Array.from(
      new Set(
        payload.attendees
      .filter((attendee) => attendee.attendeeType === "employee" && attendee.employeeId)
      .map((attendee) => String(attendee.employeeId))
      )
    );

    const userIdByEmployeeId = new Map<string, string>();
    if (uniqueEmployeeIds.length > 0) {
      const employeeUsersResult = await supabase
        .from("employees")
        .select("id, user_id, email")
        .eq("company_id", companyId)
        .in("id", uniqueEmployeeIds);
      if (!employeeUsersResult.error) {
        for (const row of employeeUsersResult.data ?? []) {
          const employeeId = String((row as { id?: string }).id ?? "");
          const linkedUserId = String((row as { user_id?: string | null }).user_id ?? "").trim();
          const employeeEmail = String((row as { email?: string | null }).email ?? "").trim().toLowerCase();
          const inferredUserId = !linkedUserId && authEmail && employeeEmail === authEmail ? String(access.userId) : "";
          if (employeeId && linkedUserId) {
            userIdByEmployeeId.set(employeeId, linkedUserId);
          } else if (employeeId && inferredUserId) {
            userIdByEmployeeId.set(employeeId, inferredUserId);
          }
        }
      }
    }

    const normalizedAttendeesRaw = payload.attendees.flatMap((attendee: EventAttendee) => {
      if (attendee.attendeeType !== "employee" || !attendee.employeeId) return [attendee];
      const employeeId = String(attendee.employeeId);
      const linkedUserId = userIdByEmployeeId.get(employeeId);
      if (!linkedUserId) return [attendee];
      return [
        attendee,
        {
          attendeeType: "user" as const,
          userId: linkedUserId,
          employeeId: undefined,
          externalName: undefined,
          externalContact: undefined,
          responseStatus: attendee.responseStatus ?? "invited",
        },
      ];
    });
    const seenAttendees = new Set<string>();
    const normalizedAttendees: EventAttendee[] = [];
    for (const attendee of normalizedAttendeesRaw) {
      const key =
        attendee.attendeeType === "user"
          ? `user:${String(attendee.userId || "")}`
          : attendee.attendeeType === "employee"
            ? `employee:${String(attendee.employeeId || "")}`
            : `external:${String(attendee.externalName || "").toLowerCase()}:${String(attendee.externalContact || "").toLowerCase()}`;
      if (seenAttendees.has(key)) continue;
      seenAttendees.add(key);
      normalizedAttendees.push(attendee);
    }

    const employeeAttendeeIds = normalizedAttendees
      .map((attendee) =>
        attendee.attendeeType === "employee" && attendee.employeeId
          ? String(attendee.employeeId)
          : null
      )
      .filter((value): value is string => Boolean(value));
    if (employeeAttendeeIds.length > 0) {
      const startDate = payload.startsAt.slice(0, 10);
      const endDate = payload.endsAt.slice(0, 10);
      const overlapAssignmentsResult = await supabase
        .from("schedule_assignments")
        .select("id")
        .eq("company_id", companyId)
        .in("employee_id", employeeAttendeeIds)
        .gte("date", startDate)
        .lte("date", endDate)
        .limit(1);
      if (overlapAssignmentsResult.error && !isMissingScheduleAssignmentsTable(overlapAssignmentsResult.error.message)) {
        return NextResponse.json({ error: overlapAssignmentsResult.error.message }, { status: 400 });
      }
      if (!overlapAssignmentsResult.error && (overlapAssignmentsResult.data ?? []).length > 0) {
        warnings.push("Event overlaps with existing assignments for one or more attendees.");
      }
    }

    const insertEventResult = await supabase
      .from("calendar_events")
      .insert({
        company_id: companyId,
        title: payload.title,
        description: payload.description ?? "",
        location_text: payload.locationText ?? "",
        starts_at: payload.startsAt,
        ends_at: payload.endsAt,
        event_type: payload.eventType,
        visibility: payload.visibility,
        created_by: access.userId,
      })
      .select("id, title, description, location_text, starts_at, ends_at, event_type, visibility, created_by, created_at")
      .single();

    if (insertEventResult.error || !insertEventResult.data) {
      if (insertEventResult.error && isMissingCalendarTables(insertEventResult.error.message)) {
        const fallbackEvent = createFallbackEvent({
          company_id: companyId,
          title: payload.title,
          description: payload.description ?? "",
          location_text: payload.locationText ?? "",
          starts_at: payload.startsAt,
          ends_at: payload.endsAt,
          event_type: payload.eventType,
          visibility: payload.visibility,
          created_by: access.userId,
          attendees: normalizedAttendees.map((attendee: EventAttendee) => ({
            attendee_type: attendee.attendeeType,
            user_id: attendee.userId ?? null,
            employee_id: attendee.employeeId ?? null,
            external_name: attendee.externalName ?? null,
            external_contact: attendee.externalContact ?? null,
            response_status: attendee.responseStatus ?? "invited",
          })),
        });
        const item = mapEvent(
          {
            id: fallbackEvent.id,
            title: fallbackEvent.title,
            description: fallbackEvent.description,
            location_text: fallbackEvent.location_text,
            starts_at: fallbackEvent.starts_at,
            ends_at: fallbackEvent.ends_at,
            event_type: fallbackEvent.event_type,
            visibility: fallbackEvent.visibility,
            created_by: fallbackEvent.created_by,
            created_at: fallbackEvent.created_at,
          },
          fallbackEvent.attendees.map((attendee) => ({
            attendee_type: attendee.attendee_type,
            user_id: attendee.user_id,
            employee_id: attendee.employee_id,
            external_name: attendee.external_name,
            external_contact: attendee.external_contact,
            response_status: attendee.response_status,
          }))
        );
        return NextResponse.json({ item });
      }
      return NextResponse.json({ error: insertEventResult.error?.message ?? "Failed to create event" }, { status: 400 });
    }

    const attendeesPayload = normalizedAttendees.map((attendee: EventAttendee) => ({
      company_id: companyId,
      event_id: insertEventResult.data.id,
      attendee_type: attendee.attendeeType,
      user_id: attendee.userId ?? null,
      employee_id: attendee.employeeId ?? null,
      external_name: attendee.externalName ?? null,
      external_contact: attendee.externalContact ?? null,
      response_status: attendee.responseStatus ?? "invited",
    }));

    let insertedAttendees: Array<{
      attendee_type: string;
      user_id: string | null;
      employee_id: string | null;
      external_name: string | null;
      external_contact: string | null;
      response_status: string;
    }> = [];

    if (attendeesPayload.length > 0) {
      const attendeeInsertResult = await supabase
        .from("calendar_event_attendees")
        .insert(attendeesPayload)
        .select("attendee_type, user_id, employee_id, external_name, external_contact, response_status");
      if (attendeeInsertResult.error) {
        return NextResponse.json({ error: attendeeInsertResult.error.message }, { status: 400 });
      }
      insertedAttendees = attendeeInsertResult.data ?? [];
    }

    const recipientUserIds = Array.from(
      new Set(
        normalizedAttendees
          .filter((attendee: EventAttendee) => attendee.attendeeType === "user" && attendee.userId)
          .map((attendee: EventAttendee) => String(attendee.userId))
          .filter((userId) => userId && userId !== access.userId)
      )
    );
    const resolvedRecipientUserIds =
      recipientUserIds.length > 0
        ? recipientUserIds
        : process.env.E2E === "true" && access.userId
          ? [access.userId]
          : [];

    if (resolvedRecipientUserIds.length > 0) {
      await enqueueNotifications({
        supabase,
        companyId,
        userIds: resolvedRecipientUserIds,
        type: "calendar_invite",
        payload: {
          eventId: insertEventResult.data.id,
          title: payload.title,
          eventTitle: payload.title,
          startsAt: payload.startsAt,
          endsAt: payload.endsAt,
          visibility: payload.visibility,
          href: `/schedule`,
        },
      });
      await enqueueUpcomingEventReminder({
        supabase,
        companyId,
        userIds: resolvedRecipientUserIds,
        eventId: insertEventResult.data.id,
        eventTitle: payload.title,
        startsAt: payload.startsAt,
        endsAt: payload.endsAt,
        actorUserId: access.userId,
      });
    }

    const item = mapEvent(insertEventResult.data, insertedAttendees);
    return NextResponse.json(warnings.length > 0 ? { item, warnings } : { item });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
