// What the device should be monitoring, and when (pure).
//
// Geofence registration is driven by the client, but WHETHER to monitor is a
// server decision — it depends on the assignment, the schedule, and whether the
// workday has already been resolved. Computing it here means the native layer,
// the employee UI, and diagnostics all read the same answer instead of each
// inventing one.
//
// A completed session is not a completed workday. Employees commonly leave and
// return for lunch, materials, or equipment, so monitoring remains active until
// the scheduled end plus the configured end-of-day cutoff.

export type MonitoringDay = {
  // Company-local work date (YYYY-MM-DD).
  workDate: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  // Retained for backward-compatible callers. A closed timecard must never set
  // this; the time window, assignment, and company switch own monitoring.
  resolved?: boolean;
};

export type MonitoringPlanInput = {
  now: string;
  // Today first, then upcoming days in ascending order.
  days: MonitoringDay[];
  monitoringLeadMinutes: number;
  // Minutes after the scheduled end at which monitoring stops for the day.
  endOfDayCutoffMinutes: number;
  // No assignment / unverified coordinates → nothing to monitor at all.
  hasMonitorableJob: boolean;
};

export type MonitoringPlan = {
  // Whether regions should be registered RIGHT NOW.
  active: boolean;
  // The window currently being served (null when nothing is active).
  windowStartsAt: string | null;
  windowEndsAt: string | null;
  // Why monitoring is not active, for the UI and diagnostics.
  inactiveReason:
    | "no_job"
    | "no_schedule"
    | "before_window"
    | "after_window"
    | null;
  // The next window to prepare for, so the device knows when to wake.
  nextWindowStartsAt: string | null;
  nextWorkDate: string | null;
};

function toTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

type Window = { startMs: number; endMs: number; day: MonitoringDay };

function windowFor(
  day: MonitoringDay,
  leadMinutes: number,
  cutoffMinutes: number
): Window | null {
  const startMs = toTime(day.scheduledStart);
  const endMs = toTime(day.scheduledEnd);
  if (startMs === null || endMs === null) return null;
  return {
    startMs: startMs - Math.max(0, leadMinutes) * 60_000,
    endMs: endMs + Math.max(0, cutoffMinutes) * 60_000,
    day,
  };
}

/**
 * Resolve the monitoring plan. Clocked-out sessions do not affect it: the
 * current workday remains active through its end-of-day cutoff so a later
 * re-entry can open a new session.
 */
export function computeMonitoringPlan(input: MonitoringPlanInput): MonitoringPlan {
  const none: MonitoringPlan = {
    active: false,
    windowStartsAt: null,
    windowEndsAt: null,
    inactiveReason: null,
    nextWindowStartsAt: null,
    nextWorkDate: null,
  };

  if (!input.hasMonitorableJob) return { ...none, inactiveReason: "no_job" };

  const nowMs = toTime(input.now) ?? Date.now();
  const windows = input.days
    .map((day) => windowFor(day, input.monitoringLeadMinutes, input.endOfDayCutoffMinutes))
    .filter((w): w is Window => w !== null)
    .sort((a, b) => a.startMs - b.startMs);

  if (windows.length === 0) return { ...none, inactiveReason: "no_schedule" };

  // The next window that has not finished. A prior clock-out is intentionally
  // irrelevant: it ended one session, not the employee's ability to return.
  const upcoming = windows.filter((w) => nowMs <= w.endMs);
  const next = upcoming[0] ?? null;

  const current = upcoming.find((w) => nowMs >= w.startMs && nowMs <= w.endMs) ?? null;
  if (current) {
    return {
      active: true,
      windowStartsAt: new Date(current.startMs).toISOString(),
      windowEndsAt: new Date(current.endMs).toISOString(),
      inactiveReason: null,
      nextWindowStartsAt: new Date(current.startMs).toISOString(),
      nextWorkDate: current.day.workDate,
    };
  }

  const reason: MonitoringPlan["inactiveReason"] = next ? "before_window" : "after_window";

  return {
    active: false,
    windowStartsAt: null,
    windowEndsAt: null,
    inactiveReason: reason,
    nextWindowStartsAt: next ? new Date(next.startMs).toISOString() : null,
    nextWorkDate: next?.day.workDate ?? null,
  };
}
