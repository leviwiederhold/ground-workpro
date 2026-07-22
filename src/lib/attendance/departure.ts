// Automatic departure → clock-out decision engine (pure).
//
// The mirror of scheduledClockIn.ts. A native geofence exit opens a
// DEPARTURE-PENDING state rather than clocking anyone out: a brief dip out of
// range (moving equipment, walking to a truck, a GPS wobble) must not end a
// shift. Only staying outside for the whole configurable grace period confirms
// the departure — and the clock-out is then recorded at the ORIGINAL exit time,
// not at whatever time the confirmation happened to be processed.
//
// The same engine also covers the missed-exit case: an employee whose exit event
// never arrived (app killed, permission revoked, phone dead) is closed out by an
// end-of-day fallback rather than left running forever.

// How late the process may be and still write the clock-out at the original
// departure time rather than abandoning the record.
export const DEFAULT_MAX_CLOCK_OUT_BACKFILL_MINUTES = 1440; // 24 hours

// Slack before a clock-out written at `effectiveAt` counts as backfilled.
export const CLOCK_OUT_BACKFILL_TOLERANCE_MS = 60_000;

export type DepartureCard = {
  clockInAt: string | null;
  clockOutAt: string | null;
  // Set at the moment the exit was observed; the anchor for the grace period
  // AND the timestamp the clock-out is ultimately recorded at.
  pendingDepartureAt: string | null;
};

export type ClockOutInput = {
  now: string;
  card: DepartureCard;
  departureGraceMinutes: number;
  // A re-entry observed after the pending departure — cancels it.
  lastEnterAt?: string | null;
  // Scheduled shift end (UTC) for the fallback path; null when the company has
  // no configured work hours and no shift assignment.
  scheduledEnd?: string | null;
  // Minutes after the scheduled end at which an employee with NO exit event is
  // closed out by the fallback. 0 disables the fallback.
  endOfDayCutoffMinutes?: number;
  maxBackfillMinutes?: number;
};

export type ClockOutAction =
  | {
      action: "clock_out";
      // The ORIGINAL validated departure time — never "now". A delayed or
      // offline confirmation must not inflate the timecard.
      effectiveAt: string;
      backfilled: boolean;
      method: "departure_grace" | "fallback_end_of_day";
    }
  | {
      action: "cancel_departure";
      reason: "returned_during_grace";
      returnedAt: string;
    }
  | { action: "hold"; reason: "within_grace"; graceEndsAt: string }
  | {
      action: "skip";
      reason:
        | "already_clocked_out"
        | "not_clocked_in"
        | "no_departure"
        | "outside_backfill_window";
    };

function toTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/**
 * Decide what to do with an open timecard.
 *
 * Ordering encodes the safety rules:
 *  1. an existing clock-out always wins (duplicate suppression);
 *  2. a record that never clocked in has nothing to close;
 *  3. a return during the grace period cancels the departure outright;
 *  4. inside the grace period we hold — brief exits never end a shift;
 *  5. past the grace period we clock out AT THE ORIGINAL EXIT TIME;
 *  6. with no exit at all, the end-of-day fallback closes the record at the
 *     scheduled end so nothing runs forever.
 */
export function decideClockOut(input: ClockOutInput): ClockOutAction {
  const nowMs = toTime(input.now) ?? Date.now();
  const card = input.card;

  // 1 + 2. Terminal / not-applicable states.
  if (card.clockOutAt) return { action: "skip", reason: "already_clocked_out" };
  if (!card.clockInAt) return { action: "skip", reason: "not_clocked_in" };

  const departureMs = toTime(card.pendingDepartureAt);
  const maxBackfillMs =
    (input.maxBackfillMinutes ?? DEFAULT_MAX_CLOCK_OUT_BACKFILL_MINUTES) * 60_000;

  if (departureMs === null) {
    // 6. No exit was ever observed. Close the record at the scheduled end once
    //    the cutoff has passed, so a missed exit event cannot leave a shift
    //    open indefinitely. This is explicitly a FALLBACK and is audited as one.
    const scheduledEndMs = toTime(input.scheduledEnd ?? null);
    const cutoffMinutes = input.endOfDayCutoffMinutes ?? 0;
    if (scheduledEndMs === null || cutoffMinutes <= 0) {
      return { action: "skip", reason: "no_departure" };
    }
    if (nowMs < scheduledEndMs + cutoffMinutes * 60_000) {
      return { action: "skip", reason: "no_departure" };
    }
    // Never close before the employee clocked in. The fallback ALWAYS closes
    // the record regardless of how late it runs — an abandoned open shift is
    // worse than a late one — and the caller marks it for manager review
    // rather than trusting the boundary.
    const clockInMs = toTime(card.clockInAt) ?? scheduledEndMs;
    const effectiveMs = Math.max(scheduledEndMs, clockInMs);
    return {
      action: "clock_out",
      effectiveAt: new Date(effectiveMs).toISOString(),
      backfilled: nowMs - effectiveMs > CLOCK_OUT_BACKFILL_TOLERANCE_MS,
      method: "fallback_end_of_day",
    };
  }

  // 3. Returned during the grace period → the departure never happened.
  const graceEndsMs = departureMs + Math.max(0, input.departureGraceMinutes) * 60_000;
  const enterMs = toTime(input.lastEnterAt ?? null);
  if (enterMs !== null && enterMs > departureMs && enterMs <= graceEndsMs) {
    return {
      action: "cancel_departure",
      reason: "returned_during_grace",
      returnedAt: new Date(enterMs).toISOString(),
    };
  }

  // 4. Still inside the grace period — a brief exit is not a departure.
  if (nowMs < graceEndsMs) {
    return { action: "hold", reason: "within_grace", graceEndsAt: new Date(graceEndsMs).toISOString() };
  }

  // 5. Confirmed departure. The clock-out is recorded at the original exit,
  //    which is what makes a delayed/offline confirmation produce the same
  //    timecard as an immediate one.
  if (nowMs - departureMs > maxBackfillMs) {
    return { action: "skip", reason: "outside_backfill_window" };
  }
  return {
    action: "clock_out",
    effectiveAt: card.pendingDepartureAt as string,
    backfilled: nowMs - graceEndsMs > CLOCK_OUT_BACKFILL_TOLERANCE_MS,
    method: "departure_grace",
  };
}
