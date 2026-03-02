import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { respondToFallbackEventInvite } from "@/lib/calendar/fallbackStore";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const bodySchema = z.object({
  responseStatus: z.enum(["accepted", "declined"]),
});

function isMissingCalendarTables(message: string) {
  const normalized = String(message || "").toLowerCase();
  const referencesCalendarTables =
    normalized.includes("calendar_events") || normalized.includes("calendar_event_attendees");
  return referencesCalendarTables && (normalized.includes("does not exist") || normalized.includes("not find"));
}

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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
    const parsedBody = bodySchema.safeParse(body);
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

    const { supabase, companyId, userId } = await getCompanyId();
    const eventId = parsedParams.data.id;
    const responseStatus = parsedBody.data.responseStatus;

    const attendeeResult = await supabase
      .from("calendar_event_attendees")
      .select("event_id, attendee_type, user_id, response_status")
      .eq("company_id", companyId)
      .eq("event_id", eventId)
      .eq("attendee_type", "user")
      .eq("user_id", userId)
      .maybeSingle();

    if (attendeeResult.error) {
      if (isMissingCalendarTables(attendeeResult.error.message)) {
        const fallbackEvent = respondToFallbackEventInvite(companyId, eventId, userId, responseStatus);
        if (!fallbackEvent) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        return NextResponse.json({
          item: {
            eventId,
            responseStatus,
          },
        });
      }
      return NextResponse.json({ error: attendeeResult.error.message }, { status: 400 });
    }

    if (!attendeeResult.data) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const updateResult = await supabase
      .from("calendar_event_attendees")
      .update({ response_status: responseStatus })
      .eq("company_id", companyId)
      .eq("event_id", eventId)
      .eq("attendee_type", "user")
      .eq("user_id", userId)
      .select("event_id, response_status")
      .maybeSingle();

    if (updateResult.error) {
      return NextResponse.json({ error: updateResult.error.message }, { status: 400 });
    }

    if (!updateResult.data) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({
      item: {
        eventId: updateResult.data.event_id,
        responseStatus: updateResult.data.response_status,
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
