import { getCompanyLocalDateKey, zonedTimeToUtcIso } from "../jobsite-time/domain.ts";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function isAttendanceDateKey(value: string): boolean {
  if (!DATE_KEY.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.toISOString().slice(0, 10) === value;
}

export function shiftAttendanceDateKey(dateKey: string, days: number): string {
  if (!isAttendanceDateKey(dateKey)) throw new Error("Invalid attendance date");
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function resolveAttendanceDateKey(
  requested: string | null | undefined,
  nowIso: string,
  timezone: string
): string | null {
  if (!requested || requested === "today") {
    return getCompanyLocalDateKey(nowIso, timezone);
  }
  return isAttendanceDateKey(requested) ? requested : null;
}

export function timestampIsOnAttendanceDate(
  timestamp: string | null | undefined,
  dateKey: string,
  timezone: string
): boolean {
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return false;
  return getCompanyLocalDateKey(timestamp, timezone) === dateKey;
}

export function companyLocalDayUtcBounds(
  dateKey: string,
  timezone: string
): { startInclusive: string; endExclusive: string } {
  if (!isAttendanceDateKey(dateKey)) throw new Error("Invalid attendance date");
  return {
    startInclusive: zonedTimeToUtcIso(dateKey, "00:00", timezone),
    endExclusive: zonedTimeToUtcIso(shiftAttendanceDateKey(dateKey, 1), "00:00", timezone),
  };
}

export function formatAttendanceDateLabel(dateKey: string): string {
  if (!isAttendanceDateKey(dateKey)) return dateKey;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${dateKey}T12:00:00.000Z`));
}
