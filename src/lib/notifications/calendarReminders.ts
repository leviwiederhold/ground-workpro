import { enqueueNotifications } from "@/lib/notifications/enqueue";
import type { getCompanyId } from "@/lib/tenant/getCompanyId";

type SupabaseClient = Awaited<ReturnType<typeof getCompanyId>>["supabase"];

type ReminderInput = {
  supabase: SupabaseClient;
  companyId: string;
  userIds: string[];
  eventId: string;
  eventTitle: string;
  startsAt: string;
  endsAt: string;
  actorUserId?: string;
  windowMinutes?: number;
  dedupeMinutes?: number;
};

function shouldSendReminder(startsAt: string, windowMinutes: number) {
  const startsAtMs = Date.parse(startsAt);
  if (!Number.isFinite(startsAtMs)) return false;
  const nowMs = Date.now();
  return startsAtMs > nowMs && startsAtMs - nowMs <= windowMinutes * 60 * 1000;
}

function uniqueUserIds(userIds: string[]) {
  return Array.from(new Set(userIds.map((id) => String(id).trim()).filter(Boolean)));
}

export async function enqueueUpcomingEventReminder(input: ReminderInput): Promise<void> {
  const recipients = uniqueUserIds(input.userIds);
  if (recipients.length === 0) return;

  const windowMinutes = Number.isFinite(input.windowMinutes) ? Number(input.windowMinutes) : 60;
  if (!shouldSendReminder(input.startsAt, windowMinutes)) return;

  const dedupeMinutes = Number.isFinite(input.dedupeMinutes) ? Number(input.dedupeMinutes) : 120;
  const dedupeSince = new Date(Date.now() - dedupeMinutes * 60 * 1000).toISOString();

  let filteredRecipients = recipients;
  try {
    const existingResult = await input.supabase
      .from("notifications")
      .select("user_id")
      .eq("company_id", input.companyId)
      .eq("type", "calendar_event_reminder")
      .eq("entity_type", "calendar_event")
      .eq("entity_id", input.eventId)
      .in("user_id", recipients)
      .gte("created_at", dedupeSince);

    if (!existingResult.error) {
      const existingUserIds = new Set(
        (existingResult.data ?? [])
          .map((row: { user_id?: string | null }) => String(row.user_id ?? "").trim())
          .filter(Boolean)
      );
      filteredRecipients = recipients.filter((userId) => !existingUserIds.has(userId));
    }
  } catch {
    // Best effort dedupe; continue and enqueue reminders.
  }

  if (filteredRecipients.length === 0) return;

  await enqueueNotifications({
    supabase: input.supabase,
    companyId: input.companyId,
    userIds: filteredRecipients,
    type: "calendar_event_reminder",
    payload: {
      eventId: input.eventId,
      eventTitle: input.eventTitle,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      href: "/schedule",
    },
    entityType: "calendar_event",
    entityId: input.eventId,
    actorUserId: input.actorUserId,
  });
}
