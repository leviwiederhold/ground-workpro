import type { SupabaseClient } from "@supabase/supabase-js";
import {
  calculateWindowHours,
  startOfUtcDay,
  startOfUtcWeek,
  type TimeEntryRow,
} from "@/lib/time-clock/hours";
import { chunkValues } from "@/lib/db/chunk";

type TimeEntrySummary = {
  todayHoursByUserId: Map<string, number>;
  weekHoursByUserId: Map<string, number>;
  activeShiftStartByUserId: Map<string, string>;
};

export async function getTimeEntrySummaryByUser(params: {
  supabase: SupabaseClient;
  companyId: string;
  userIds: string[];
  now?: Date;
}): Promise<TimeEntrySummary> {
  const uniqueUserIds = Array.from(new Set(params.userIds.map((value) => String(value)).filter(Boolean)));
  const emptySummary: TimeEntrySummary = {
    todayHoursByUserId: new Map<string, number>(),
    weekHoursByUserId: new Map<string, number>(),
    activeShiftStartByUserId: new Map<string, string>(),
  };
  if (uniqueUserIds.length === 0) return emptySummary;

  const now = params.now ?? new Date();
  const dayStart = startOfUtcDay(now);
  const weekStart = startOfUtcWeek(now);
  const queryStart = new Date(weekStart.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const weekStartIso = weekStart.toISOString();

  const rows: Array<{
    user_id: string;
    clock_in_at: string;
    clock_out_at: string | null;
  }> = [];
  for (const userIdChunk of chunkValues(uniqueUserIds)) {
    const result = await params.supabase
      .from("time_entries")
      .select("user_id, clock_in_at, clock_out_at")
      .eq("company_id", params.companyId)
      .in("user_id", userIdChunk)
      .or(`clock_out_at.gte.${weekStartIso},clock_out_at.is.null,clock_in_at.gte.${queryStart}`)
      .order("clock_in_at", { ascending: false });

    if (result.error) {
      return emptySummary;
    }
    rows.push(...((result.data ?? []) as typeof rows));
  }

  const entriesByUserId = new Map<string, TimeEntryRow[]>();
  for (const row of rows) {
    const userId = String(row.user_id ?? "").trim();
    if (!userId) continue;
    const list = entriesByUserId.get(userId) ?? [];
    list.push({ clock_in_at: row.clock_in_at, clock_out_at: row.clock_out_at });
    entriesByUserId.set(userId, list);
    if (row.clock_out_at === null && !emptySummary.activeShiftStartByUserId.has(userId)) {
      emptySummary.activeShiftStartByUserId.set(userId, row.clock_in_at);
    }
  }

  for (const userId of uniqueUserIds) {
    const entries = entriesByUserId.get(userId) ?? [];
    emptySummary.todayHoursByUserId.set(
      userId,
      calculateWindowHours({ entries, rangeStart: dayStart, rangeEnd: now, now })
    );
    emptySummary.weekHoursByUserId.set(
      userId,
      calculateWindowHours({ entries, rangeStart: weekStart, rangeEnd: now, now })
    );
  }

  return emptySummary;
}
