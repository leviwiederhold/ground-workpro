import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { enqueueNotifications } from "@/lib/notifications/enqueue";

type AttendeeInput = {
  attendeeType: "user" | "employee" | "external";
  userId?: string;
  employeeId?: string;
  externalName?: string;
  externalContact?: string;
  responseStatus?: string;
};

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
  .transform((value: {
    attendeeType?: "user" | "employee" | "external";
    type?: "user" | "employee" | "external";
    userId?: string;
    employeeId?: string;
    externalName?: string;
    externalContact?: string;
    responseStatus?: string;
  }) => ({
    attendeeType: value.attendeeType ?? value.type,
    userId: value.userId,
    employeeId: value.employeeId,
    externalName: value.externalName,
    externalContact: value.externalContact,
    responseStatus: value.responseStatus,
  }))
  .superRefine((value: AttendeeInput, ctx: { addIssue: (issue: { code: string; path?: (string | number)[]; message: string }) => void }) => {
    if (!value.attendeeType) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["type"], message: "type is required" });
      return;
    }
    if (value.attendeeType === "user" && !value.userId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["userId"], message: "userId is required for user attendee" });
    }
    if (value.attendeeType === "employee" && !value.employeeId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["employeeId"], message: "employeeId is required for employee attendee" });
    }
    if (value.attendeeType === "external" && !value.externalName) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["externalName"], message: "externalName is required for external attendee" });
    }
  });

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

export async function POST(request: Request) {
  try {
    let access: Awaited<ReturnType<typeof requireRole>>;
    try {
      access = await requireRole(["admin", "pm"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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
    const payload = parsedBody.data;
    const warnings: string[] = [];

    const employeeAttendeeIds = payload.attendees
      .filter((attendee: AttendeeInput) => attendee.attendeeType === "employee" && attendee.employeeId)
      .map((attendee: AttendeeInput) => String(attendee.employeeId));
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
      if (overlapAssignmentsResult.error) {
        return NextResponse.json({ error: overlapAssignmentsResult.error.message }, { status: 400 });
      }
      if ((overlapAssignmentsResult.data ?? []).length > 0) {
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
      return NextResponse.json({ error: insertEventResult.error?.message ?? "Failed to create event" }, { status: 400 });
    }

    const attendeesPayload = payload.attendees.map((attendee: AttendeeInput) => ({
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
      new Set([
        access.userId,
        ...payload.attendees
          .filter((attendee: AttendeeInput) => attendee.attendeeType === "user" && attendee.userId)
          .map((attendee: AttendeeInput) => String(attendee.userId)),
      ])
    );

    await enqueueNotifications({
      supabase,
      companyId,
      userIds: recipientUserIds,
      type: "event_invited",
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
