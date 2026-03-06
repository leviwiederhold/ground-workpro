import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { supabaseServer } from "@/lib/supabase/server";
import { formatNotification, type NotificationType } from "@/lib/notifications/format";
import { markFallbackNotificationRead } from "@/lib/notifications/fallbackStore";

type NotificationRow = {
  id: string;
  type: NotificationType;
  payload: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
};

const paramsSchema = z.object({
  id: z.string().uuid(),
});

function isMissingNotificationsTable(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("notifications") &&
    (normalized.includes("does not exist") || normalized.includes("not find"))
  );
}

async function resolveContext() {
  const supabase = await supabaseServer();
  const userResult = await supabase.auth.getUser();
  if (userResult.error || !userResult.data?.user) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }

  const userId = userResult.data.user.id;
  const membershipResult = await supabase
    .from("memberships")
    .select("company_id")
    .eq("user_id", userId)
    .order("company_id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (membershipResult.error) {
    return { error: NextResponse.json({ error: membershipResult.error.message }, { status: 400 }) };
  }
  if (!membershipResult.data?.company_id) {
    return { error: NextResponse.json({ error: "No company membership found (run bootstrap)" }, { status: 403 }) };
  }

  return {
    supabase,
    companyId: String(membershipResult.data.company_id),
    userId,
  };
}

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
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

    const context = await resolveContext();
    if ("error" in context) return context.error;

    const result = await context.supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("company_id", context.companyId)
      .eq("user_id", context.userId)
      .eq("id", parsedParams.data.id)
      .select("id, type, payload, read_at, created_at")
      .maybeSingle();

    if (result.error) {
      if (isMissingNotificationsTable(result.error.message)) {
        const fallbackRow = markFallbackNotificationRead({
          companyId: context.companyId,
          notificationId: parsedParams.data.id,
          userId: context.userId,
          companyWide: false,
        });
        if (!fallbackRow) {
          return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        const fallbackPayload = (fallbackRow.payload ?? {}) as Record<string, unknown>;
        const fallbackDisplay = formatNotification(fallbackRow.type, fallbackPayload);
        return NextResponse.json({
          item: {
            id: fallbackRow.id,
            readAt: fallbackRow.read_at,
            notification_type: fallbackRow.type,
            title: fallbackDisplay.title,
            message: fallbackDisplay.message,
            payload: fallbackPayload,
            is_read: Boolean(fallbackRow.read_at),
            read_at: fallbackRow.read_at,
            created_at: fallbackRow.created_at,
          },
        });
      }
      return NextResponse.json({ error: result.error.message }, { status: 400 });
    }

    if (!result.data) {
      const fallbackRow = markFallbackNotificationRead({
        companyId: context.companyId,
        notificationId: parsedParams.data.id,
        userId: context.userId,
        companyWide: false,
      });
      if (!fallbackRow) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const fallbackPayload = (fallbackRow.payload ?? {}) as Record<string, unknown>;
      const fallbackDisplay = formatNotification(fallbackRow.type, fallbackPayload);
      return NextResponse.json({
        item: {
          id: fallbackRow.id,
          readAt: fallbackRow.read_at,
          notification_type: fallbackRow.type,
          title: fallbackDisplay.title,
          message: fallbackDisplay.message,
          payload: fallbackPayload,
          is_read: Boolean(fallbackRow.read_at),
          read_at: fallbackRow.read_at,
          created_at: fallbackRow.created_at,
        },
      });
    }

    const row = result.data as NotificationRow;
    const payload = row.payload ?? {};
    const display = formatNotification(row.type, payload);

    return NextResponse.json({
      item: {
        id: row.id,
        readAt: row.read_at,
        notification_type: row.type,
        title: display.title,
        message: display.message,
        payload,
        is_read: Boolean(row.read_at),
        read_at: row.read_at,
        created_at: row.created_at,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
