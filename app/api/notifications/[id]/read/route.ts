import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { formatNotification, type NotificationType } from "@/lib/notifications/format";
import { markFallbackNotificationRead } from "@/lib/notifications/fallbackStore";

type NotificationRow = {
  id: string;
  type: NotificationType;
  title: string | null;
  body: string | null;
  link: string | null;
  payload: Record<string, unknown> | null;
  is_read: boolean | null;
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

function isMissingNotificationsColumns(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("column") && (normalized.includes("is_read") || normalized.includes("title") || normalized.includes("body") || normalized.includes("link"));
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
    return { error: NextResponse.json({ error: "No company workspace found" }, { status: 403 }) };
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

    const readAt = new Date().toISOString();
    const result = await context.supabase
      .from("notifications")
      .update({ read_at: readAt, is_read: true })
      .eq("company_id", context.companyId)
      .eq("user_id", context.userId)
      .eq("id", parsedParams.data.id)
      .select("id, type, title, body, link, payload, is_read, read_at, created_at")
      .maybeSingle();

    if (result.error && isMissingNotificationsColumns(result.error.message || "")) {
      const legacy = await context.supabase
        .from("notifications")
        .update({ read_at: readAt })
        .eq("company_id", context.companyId)
        .eq("user_id", context.userId)
        .eq("id", parsedParams.data.id)
        .select("id, type, payload, read_at, created_at")
        .maybeSingle();
      if (!legacy.error && legacy.data) {
        const legacyRow = legacy.data as {
          id: string;
          type: NotificationType;
          payload: Record<string, unknown> | null;
          read_at: string | null;
          created_at: string;
        };
        const payload = legacyRow.payload ?? {};
        const display = formatNotification(legacyRow.type, payload);
        return NextResponse.json({
          item: {
            id: legacyRow.id,
            readAt: legacyRow.read_at,
            notification_type: legacyRow.type,
            title: display.title,
            body: display.message,
            message: display.message,
            link: String(display.link ?? payload.href ?? ""),
            payload,
            is_read: true,
            read_at: legacyRow.read_at,
            created_at: legacyRow.created_at,
          },
        });
      }
    }

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
            body: fallbackDisplay.message,
            message: fallbackDisplay.message,
            link: String(fallbackDisplay.link ?? fallbackPayload.href ?? ''),
            payload: fallbackPayload,
            is_read: true,
            read_at: fallbackRow.read_at,
            created_at: fallbackRow.created_at,
          },
        });
      }
      return NextResponse.json({ error: result.error.message }, { status: 400 });
    }

    if (!result.data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const row = result.data as NotificationRow;
    const payload = row.payload ?? {};
    const display = formatNotification(row.type, payload);
    const title = String(row.title ?? display.title);
    const body = String(row.body ?? display.message);
    const link = String(row.link ?? display.link ?? (payload.href ?? ''));

    return NextResponse.json({
      item: {
        id: row.id,
        readAt: row.read_at,
        notification_type: row.type,
        title,
        body,
        message: body,
        link,
        payload,
        is_read: true,
        read_at: row.read_at,
        created_at: row.created_at,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
