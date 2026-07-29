import {
  scheduledWindowForWorkDate,
  type CompanyWorkScheduleSettings,
} from "../jobsite-time/domain.ts";

export type CompanyBreakSchedule = {
  startTime: string | null;
  endTime: string | null;
  returnGraceMinutes: number;
  timezone: string;
};

export type BreakSession = {
  clockInAt: string | null;
  clockOutAt: string | null;
};

export type CompanyBreakState =
  | { status: "none"; departureAt: null; returnAt: null; returnDueAt: null }
  | {
      status: "expected_break" | "not_returned" | "returned_late";
      departureAt: string;
      returnAt: string | null;
      returnDueAt: string;
    };

const NO_BREAK: CompanyBreakState = {
  status: "none",
  departureAt: null,
  returnAt: null,
  returnDueAt: null,
};

const EVERY_DAY = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function time(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Derive an admin-only break exception from ordinary clock-out/clock-in
 * sessions. This never changes attendance events or monitoring state.
 *
 * A departure is a scheduled break only when it occurs inside the configured
 * break window. A later session is its return. A timely return clears the
 * derived state; a late return remains visible to managers, and an unmatched
 * departure becomes "not returned" after the configured grace period.
 */
export function deriveCompanyBreakState(input: {
  now: string;
  workDate: string;
  schedule: CompanyBreakSchedule;
  sessions: BreakSession[];
}): CompanyBreakState {
  const { schedule } = input;
  if (!schedule.startTime || !schedule.endTime) return NO_BREAK;

  const windowSettings: CompanyWorkScheduleSettings = {
    timezone: schedule.timezone,
    workDays: EVERY_DAY,
    workStartTime: schedule.startTime,
    workEndTime: schedule.endTime,
    earlyArrivalWindowMinutes: 0,
    lateGraceMinutes: 0,
  };
  const window = scheduledWindowForWorkDate(input.workDate, windowSettings);
  const startMs = time(window.scheduledStart);
  const endMs = time(window.scheduledEnd);
  const nowMs = time(input.now);
  if (startMs === null || endMs === null || nowMs === null) return NO_BREAK;

  const returnDueMs = endMs + Math.max(0, schedule.returnGraceMinutes) * 60_000;
  const sessions = input.sessions
    .filter((session) => time(session.clockInAt) !== null)
    .slice()
    .sort((a, b) => (time(a.clockInAt) ?? 0) - (time(b.clockInAt) ?? 0));

  let lateReturn: CompanyBreakState | null = null;
  for (const session of sessions) {
    const departureMs = time(session.clockOutAt);
    if (departureMs === null || departureMs < startMs || departureMs > endMs) continue;

    const nextSession = sessions.find((candidate) => {
      const arrivalMs = time(candidate.clockInAt);
      return arrivalMs !== null && arrivalMs > departureMs;
    });
    const returnMs = time(nextSession?.clockInAt);
    const departureAt = new Date(departureMs).toISOString();
    const returnDueAt = new Date(returnDueMs).toISOString();

    if (returnMs === null) {
      return {
        status: nowMs > returnDueMs ? "not_returned" : "expected_break",
        departureAt,
        returnAt: null,
        returnDueAt,
      };
    }

    if (returnMs > returnDueMs) {
      lateReturn = {
        status: "returned_late",
        departureAt,
        returnAt: new Date(returnMs).toISOString(),
        returnDueAt,
      };
    }
  }

  return lateReturn ?? NO_BREAK;
}
