// Automatic arrival → clock-in decision engine (pure).
//
// One function decides, for a single arrived-but-not-yet-clocked-in timecard,
// whether to create the clock-in now, keep holding, or refuse. It is the SINGLE
// source of truth shared by every caller so the four independent paths that can
// reach it — a native geofence event, foreground reconciliation, the server-side
// scheduled process, and an offline queue flush — can never disagree and can
// never produce two clock-ins.
//
// The interesting case is `earlyArrivalMode: "scheduled_start"`: an employee who
// arrives at 6:50 for a 7:00 shift is recorded as ONSITE at 6:50 but is not
// clocked in until 7:00 — by the server, with the app closed.

export type EarlyArrivalMode = "clock_in_on_arrival" | "scheduled_start";

// How late the scheduled process may be and still write the clock-in at the
// scheduled start rather than skipping the day. Generous on purpose: a delayed
// or failed run must not cost an employee their whole shift.
export const DEFAULT_MAX_BACKFILL_MINUTES = 720; // 12 hours

// Slack before a clock-in written at `effectiveAt` counts as a BACKFILL rather
// than an on-time write. One minute matches the scheduler's tick interval.
export const BACKFILL_TOLERANCE_MS = 60_000;

export type ArrivalCard = {
  // Set once the employee is inside the arrival radius; cleared on clock-in or
  // when they leave before the arrival is confirmed.
  pendingArrivalAt: string | null;
  clockInAt: string | null;
  clockOutAt: string | null;
  // Already stamped as onsite-before-shift (so we don't re-log the audit event).
  onsiteBeforeShiftAt: string | null;
};

export type ArrivalClockInInput = {
  now: string;
  card: ArrivalCard;
  // Scheduled shift start for this timecard's work date, in UTC. Null when the
  // company has no configured work hours and no per-day shift assignment.
  scheduledStart: string | null;
  earlyArrivalMode: EarlyArrivalMode;
  // Continuous seconds inside the radius before an arrival is trusted.
  arrivalConfirmationSeconds: number;
  // The employee's most recent exit from THIS jobsite, if it landed after the
  // arrival (a delayed/offline exit that the arrival row hasn't absorbed yet).
  lastExitAt?: string | null;
  // Another job this employee is currently clocked into and not leaving.
  // Non-null means a second concurrent clock-in must be refused.
  openElsewhereJobId?: string | null;
  maxBackfillMinutes?: number;
};

export type ClockInAction =
  | {
      action: "clock_in";
      // The timestamp the clock-in is recorded AT — the scheduled start when
      // holding for it, otherwise the confirmed arrival.
      effectiveAt: string;
      // True when the scheduled process ran late and we wrote a past timestamp.
      backfilled: boolean;
      method: "arrival" | "scheduled_start" | "scheduled_start_backfilled";
    }
  | {
      action: "hold";
      reason: "arrival_not_confirmed" | "before_scheduled_start";
      // When holding for the shift start, the arrival that is being held.
      onsiteSince: string | null;
      // True the first time an onsite-before-shift hold is observed, so the
      // caller stamps it and logs the audit event exactly once.
      recordOnsiteBeforeShift: boolean;
    }
  | {
      action: "skip";
      reason:
        | "already_clocked_in"
        | "already_closed"
        | "no_arrival_evidence"
        | "left_before_shift"
        | "clocked_in_elsewhere"
        | "outside_backfill_window";
    };

function toTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/**
 * Decide what to do with an arrival that has not produced a clock-in yet.
 *
 * Ordering matters and encodes the safety rules:
 *  1. an existing clock-in always wins (duplicate suppression);
 *  2. no arrival evidence → never invent a clock-in;
 *  3. the arrival must survive the confirmation dwell;
 *  4. a departure before the target time cancels the clock-in entirely;
 *  5. a clock-in open at another job blocks a second concurrent one;
 *  6. before the target time we HOLD (recording onsite-before-shift once);
 *  7. at/after the target time we clock in, backfilling to the target.
 */
export function decideArrivalClockIn(input: ArrivalClockInInput): ClockInAction {
  const nowMs = toTime(input.now) ?? Date.now();
  const card = input.card;

  // 1. Duplicate suppression — the record already exists, whoever created it.
  if (card.clockOutAt) return { action: "skip", reason: "already_closed" };
  if (card.clockInAt) return { action: "skip", reason: "already_clocked_in" };

  // 2. No confirmed presence at the jobsite → nothing to act on. (The events
  //    route clears pending_arrival_at when someone leaves before confirmation,
  //    so this is also the ordinary "arrived then left" path.)
  const arrivalMs = toTime(card.pendingArrivalAt);
  if (arrivalMs === null) return { action: "skip", reason: "no_arrival_evidence" };

  // 3. Arrival dwell — a drive-by that clips the fence is not an arrival.
  const confirmedAtMs = arrivalMs + Math.max(0, input.arrivalConfirmationSeconds) * 1000;
  if (nowMs < confirmedAtMs) {
    return {
      action: "hold",
      reason: "arrival_not_confirmed",
      onsiteSince: card.pendingArrivalAt,
      recordOnsiteBeforeShift: false,
    };
  }

  // Target = when the clock-in should be recorded.
  const scheduledStartMs = toTime(input.scheduledStart);
  const holdForShift =
    input.earlyArrivalMode === "scheduled_start" &&
    scheduledStartMs !== null &&
    arrivalMs < scheduledStartMs;
  const targetMs = holdForShift ? (scheduledStartMs as number) : arrivalMs;

  // 4. Left before the clock-in was due. A departure recorded at/after the
  //    target still counts as a worked shift (PR 12 closes it); a departure
  //    BEFORE it means they were never on the clock.
  const exitMs = toTime(input.lastExitAt);
  if (exitMs !== null && exitMs > arrivalMs && exitMs < targetMs) {
    return { action: "skip", reason: "left_before_shift" };
  }

  // 5. Never hold two concurrent clock-ins for one employee.
  if (input.openElsewhereJobId) {
    return { action: "skip", reason: "clocked_in_elsewhere" };
  }

  // 6. Still early — hold, and mark onsite-before-shift the first time.
  if (nowMs < targetMs) {
    return {
      action: "hold",
      reason: "before_scheduled_start",
      onsiteSince: card.pendingArrivalAt,
      recordOnsiteBeforeShift: holdForShift && !card.onsiteBeforeShiftAt,
    };
  }

  // 7. Due. If the scheduled process is running late we still write the clock-in
  //    at the correct target time (backfill), because the arrival evidence above
  //    already proves the employee was onsite and never left.
  const lateByMs = nowMs - targetMs;
  const maxBackfillMs = (input.maxBackfillMinutes ?? DEFAULT_MAX_BACKFILL_MINUTES) * 60_000;
  if (lateByMs > maxBackfillMs) {
    return { action: "skip", reason: "outside_backfill_window" };
  }

  const backfilled = holdForShift && lateByMs > BACKFILL_TOLERANCE_MS;
  return {
    action: "clock_in",
    effectiveAt: new Date(targetMs).toISOString(),
    backfilled,
    method: holdForShift ? (backfilled ? "scheduled_start_backfilled" : "scheduled_start") : "arrival",
  };
}
