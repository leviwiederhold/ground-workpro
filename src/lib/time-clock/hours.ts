export type TimeEntryRow = {
  clock_in_at: string;
  clock_out_at: string | null;
};

const MS_IN_HOUR = 1000 * 60 * 60;

function toDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function overlapMs(params: {
  start: Date;
  end: Date;
  rangeStart: Date;
  rangeEnd: Date;
}) {
  const effectiveStart = Math.max(params.start.getTime(), params.rangeStart.getTime());
  const effectiveEnd = Math.min(params.end.getTime(), params.rangeEnd.getTime());
  return Math.max(0, effectiveEnd - effectiveStart);
}

export function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

export function startOfUtcWeek(date: Date) {
  const dayStart = startOfUtcDay(date);
  const utcDay = dayStart.getUTCDay(); // 0=Sun
  const daysSinceMonday = (utcDay + 6) % 7;
  return new Date(dayStart.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000);
}

export function toRoundedHours(ms: number) {
  return Math.round((ms / MS_IN_HOUR) * 100) / 100;
}

export function calculateWindowHours(params: {
  entries: TimeEntryRow[];
  rangeStart: Date;
  rangeEnd: Date;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  let totalMs = 0;

  for (const entry of params.entries) {
    const start = toDate(entry.clock_in_at);
    if (!start) continue;
    const end = entry.clock_out_at ? toDate(entry.clock_out_at) : now;
    if (!end) continue;
    totalMs += overlapMs({
      start,
      end,
      rangeStart: params.rangeStart,
      rangeEnd: params.rangeEnd,
    });
  }

  return toRoundedHours(totalMs);
}
