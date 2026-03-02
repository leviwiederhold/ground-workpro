import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { enqueueNotifications } from "@/lib/notifications/enqueue";
import { deleteFallbackEvent, getFallbackEventById, updateFallbackEvent } from "@/lib/calendar/fallbackStore";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const patchEventSchema = z
  .object({
    title: z.string().min(1).optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    visibility: z.enum(["attendees", "company", "private"]).optional(),
    eventType: z.enum(["meeting", "client", "inspection", "delivery", "internal"]).optional(),
    locationText: z.string().optional(),
    description: z.string().optional(),
  })
  .refine((value: { startsAt?: string; endsAt?: string }) => {
    if (!value.startsAt || !value.endsAt) return true;
    return new Date(value.endsAt).getTime() > new Date(value.startsAt).getTime();
  }, {
    path: ["endsAt"],
    message: "endsAt must be after startsAt",
  });

const mapEvent = (event: {
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
}) => ({
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
});

export const dynamic = "force-dynamic";

function isMissingCalendarTables(message: string) {
  const normalized = String(message || "").toLowerCase();
  const referencesCalendarTables =
    normalized.includes("calendar_events") || normalized.includes("calendar_event_attendees");
  return referencesCalendarTables && (normalized.includes("does not exist") || normalized.includes("not find"));
}

export async function PATCH(
  request: Request,
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

    const body = await request.json().catch(() => null);
    const parsedBody = patchEventSchema.safeParse(body);
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

    const payload = parsedBody.data;
    const updatePayload: Record<string, unknown> = {};
    if (payload.title !== undefined) updatePayload.title = payload.title;
    if (payload.description !== undefined) updatePayload.description = payload.description;
    if (payload.locationText !== undefined) updatePayload.location_text = payload.locationText;
    if (payload.startsAt !== undefined) updatePayload.starts_at = payload.startsAt;
    if (payload.endsAt !== undefined) updatePayload.ends_at = payload.endsAt;
    if (payload.eventType !== undefined) updatePayload.event_type = payload.eventType;
    if (payload.visibility !== undefined) updatePayload.visibility = payload.visibility;

    const { supabase, companyId } = await getCompanyId();
    const attendeeResult = await supabase
      .from("calendar_event_attendees")
      .select("user_id")
      .eq("company_id", companyId)
      .eq("event_id", parsedParams.data.id)
      .eq("attendee_type", "user");

    const updateResult = await supabase
      .from("calendar_events")
      .update(updatePayload)
      .eq("company_id", companyId)
      .eq("id", parsedParams.data.id)
      .select("id, title, description, location_text, starts_at, ends_at, event_type, visibility, created_by, created_at")
      .single();

    if (updateResult.error || !updateResult.data) {
      if (updateResult.error && isMissingCalendarTables(updateResult.error.message)) {
        const fallbackUpdated = updateFallbackEvent(companyId, parsedParams.data.id, {
          ...(payload.title !== undefined ? { title: payload.title } : {}),
          ...(payload.description !== undefined ? { description: payload.description } : {}),
          ...(payload.locationText !== undefined ? { location_text: payload.locationText } : {}),
          ...(payload.startsAt !== undefined ? { starts_at: payload.startsAt } : {}),
          ...(payload.endsAt !== undefined ? { ends_at: payload.endsAt } : {}),
          ...(payload.eventType !== undefined ? { event_type: payload.eventType } : {}),
          ...(payload.visibility !== undefined ? { visibility: payload.visibility } : {}),
        });
        if (!fallbackUpdated) {
          return NextResponse.json({ error: "Event not found" }, { status: 404 });
        }
        return NextResponse.json({
          item: mapEvent({
            id: fallbackUpdated.id,
            title: fallbackUpdated.title,
            description: fallbackUpdated.description,
            location_text: fallbackUpdated.location_text,
            starts_at: fallbackUpdated.starts_at,
            ends_at: fallbackUpdated.ends_at,
            event_type: fallbackUpdated.event_type,
            visibility: fallbackUpdated.visibility,
            created_by: fallbackUpdated.created_by,
            created_at: fallbackUpdated.created_at,
          }),
        });
      }
      return NextResponse.json({ error: updateResult.error?.message ?? "Event not found" }, { status: 404 });
    }

    const recipientUserIds = Array.from(
      new Set([
        access.userId,
        ...((attendeeResult.data ?? [])
          .map((item: { user_id: string | null }) => item.user_id)
          .filter(Boolean) as string[]),
      ])
    );
    await enqueueNotifications({
      supabase,
      companyId,
      userIds: recipientUserIds,
      type: "event_updated",
      payload: {
        eventId: updateResult.data.id,
        eventTitle: updateResult.data.title,
        startsAt: updateResult.data.starts_at,
        endsAt: updateResult.data.ends_at,
      },
    });

    return NextResponse.json({ item: mapEvent(updateResult.data) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

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
    const eventResult = await supabase
      .from("calendar_events")
      .select("id, title, starts_at, ends_at")
      .eq("company_id", companyId)
      .eq("id", parsedParams.data.id)
      .maybeSingle();

    if (eventResult.error) {
      if (isMissingCalendarTables(eventResult.error.message)) {
        const fallbackEvent = getFallbackEventById(companyId, parsedParams.data.id);
        if (!fallbackEvent) {
          return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        const deleted = deleteFallbackEvent(companyId, parsedParams.data.id);
        if (!deleted) {
          return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        return NextResponse.json({ success: true });
      }
      return NextResponse.json({ error: eventResult.error.message }, { status: 400 });
    }
    if (!eventResult.data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const attendeeResult = await supabase
      .from("calendar_event_attendees")
      .select("user_id")
      .eq("company_id", companyId)
      .eq("event_id", parsedParams.data.id)
      .eq("attendee_type", "user");

    const deleteResult = await supabase
      .from("calendar_events")
      .delete()
      .eq("company_id", companyId)
      .eq("id", parsedParams.data.id)
      .select("id");

    if (deleteResult.error) {
      return NextResponse.json({ error: deleteResult.error.message }, { status: 400 });
    }
    if (!deleteResult.data || deleteResult.data.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const recipientUserIds = Array.from(
      new Set([
        access.userId,
        ...((attendeeResult.data ?? [])
          .map((item: { user_id: string | null }) => item.user_id)
          .filter(Boolean) as string[]),
      ])
    );
    await enqueueNotifications({
      supabase,
      companyId,
      userIds: recipientUserIds,
      type: "event_canceled",
      payload: {
        eventId: eventResult.data.id,
        eventTitle: eventResult.data.title,
        startsAt: eventResult.data.starts_at,
        endsAt: eventResult.data.ends_at,
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
