import test from "node:test";
import assert from "node:assert/strict";
import {
  decideArrivalClockIn,
  DEFAULT_MAX_BACKFILL_MINUTES,
  type ArrivalClockInInput,
} from "../../src/lib/attendance/scheduledClockIn.ts";
import {
  buildOpenElsewhere,
  resolveScheduledStart,
} from "../../src/lib/attendance/scheduledClockInRunner.ts";
import { scheduledWindowForWorkDate } from "../../src/lib/jobsite-time/domain.ts";
import { resolveArrivalConfirmationSeconds } from "../../src/lib/attendance/attendanceSettings.ts";

// The acceptance scenario: 7:00 AM shift, employee arrives 6:50 AM.
// America/New_York in July is UTC-4, so 07:00 local = 11:00Z.
const SHIFT_START = "2026-07-21T11:00:00.000Z";
const ARRIVED_0650 = "2026-07-21T10:50:00.000Z";

function input(over: Partial<ArrivalClockInInput> = {}): ArrivalClockInInput {
  return {
    now: SHIFT_START,
    card: {
      pendingArrivalAt: ARRIVED_0650,
      clockInAt: null,
      clockOutAt: null,
      onsiteBeforeShiftAt: null,
    },
    scheduledStart: SHIFT_START,
    earlyArrivalMode: "scheduled_start",
    arrivalConfirmationSeconds: 120,
    ...over,
  };
}

// ── The acceptance criteria ──────────────────────────────────────────────────

test("arrival before shift is held, not clocked in, and flags onsite-before-shift once", () => {
  const at0652 = decideArrivalClockIn(input({ now: "2026-07-21T10:52:00.000Z" }));
  assert.equal(at0652.action, "hold");
  assert.equal(at0652.action === "hold" && at0652.reason, "before_scheduled_start");
  assert.equal(at0652.action === "hold" && at0652.recordOnsiteBeforeShift, true);
  assert.equal(at0652.action === "hold" && at0652.onsiteSince, ARRIVED_0650);

  // Already stamped → the audit event is not logged again on the next pass.
  const at0655 = decideArrivalClockIn(
    input({
      now: "2026-07-21T10:55:00.000Z",
      card: { ...input().card, onsiteBeforeShiftAt: ARRIVED_0650 },
    })
  );
  assert.equal(at0655.action, "hold");
  assert.equal(at0655.action === "hold" && at0655.recordOnsiteBeforeShift, false);
});

test("clock-in is created at the scheduled start, not the arrival time", () => {
  const decision = decideArrivalClockIn(input({ now: SHIFT_START }));
  assert.equal(decision.action, "clock_in");
  assert.equal(decision.action === "clock_in" && decision.effectiveAt, SHIFT_START);
  assert.equal(decision.action === "clock_in" && decision.backfilled, false);
  assert.equal(decision.action === "clock_in" && decision.method, "scheduled_start");
});

test("a later reconciliation does not create a duplicate", () => {
  const decision = decideArrivalClockIn(
    input({
      now: "2026-07-21T12:00:00.000Z",
      card: { pendingArrivalAt: null, clockInAt: SHIFT_START, clockOutAt: null, onsiteBeforeShiftAt: ARRIVED_0650 },
    })
  );
  assert.equal(decision.action, "skip");
  assert.equal(decision.action === "skip" && decision.reason, "already_clocked_in");
});

test("leaving before the shift start creates no clock-in", () => {
  // The events route clears pending_arrival_at on an exit before confirmation.
  const cleared = decideArrivalClockIn(input({ card: { ...input().card, pendingArrivalAt: null } }));
  assert.equal(cleared.action, "skip");
  assert.equal(cleared.action === "skip" && cleared.reason, "no_arrival_evidence");

  // A late/offline exit that the row has not absorbed yet is also honored.
  const lateExit = decideArrivalClockIn(input({ lastExitAt: "2026-07-21T10:55:00.000Z" }));
  assert.equal(lateExit.action, "skip");
  assert.equal(lateExit.action === "skip" && lateExit.reason, "left_before_shift");
});

// ── earlyArrivalMode ─────────────────────────────────────────────────────────

test("clock_in_on_arrival clocks in at the arrival once the dwell elapses", () => {
  const decision = decideArrivalClockIn(
    input({ now: "2026-07-21T10:52:00.000Z", earlyArrivalMode: "clock_in_on_arrival" })
  );
  assert.equal(decision.action, "clock_in");
  assert.equal(decision.action === "clock_in" && decision.effectiveAt, ARRIVED_0650);
  assert.equal(decision.action === "clock_in" && decision.method, "arrival");
});

test("no scheduled start means there is nothing to hold for", () => {
  const decision = decideArrivalClockIn(
    input({ now: "2026-07-21T10:53:00.000Z", scheduledStart: null })
  );
  assert.equal(decision.action, "clock_in");
  assert.equal(decision.action === "clock_in" && decision.effectiveAt, ARRIVED_0650);
});

test("arriving after the scheduled start clocks in at the arrival, not backwards", () => {
  const lateArrival = "2026-07-21T11:20:00.000Z";
  const decision = decideArrivalClockIn(
    input({
      now: "2026-07-21T11:25:00.000Z",
      card: { ...input().card, pendingArrivalAt: lateArrival },
    })
  );
  assert.equal(decision.action, "clock_in");
  assert.equal(decision.action === "clock_in" && decision.effectiveAt, lateArrival);
  assert.equal(decision.action === "clock_in" && decision.backfilled, false);
});

// ── Dwell / confirmation ─────────────────────────────────────────────────────

test("an arrival that has not survived the dwell is held", () => {
  const decision = decideArrivalClockIn(
    input({ now: "2026-07-21T10:50:30.000Z", earlyArrivalMode: "clock_in_on_arrival" })
  );
  assert.equal(decision.action, "hold");
  assert.equal(decision.action === "hold" && decision.reason, "arrival_not_confirmed");
});

test("the enforced dwell is the stricter of the two company knobs", () => {
  assert.equal(resolveArrivalConfirmationSeconds({ arrivalDwellMinutes: 2 }, 45), 120);
  assert.equal(resolveArrivalConfirmationSeconds({ arrivalDwellMinutes: 0 }, 45), 45);
  assert.equal(resolveArrivalConfirmationSeconds({ arrivalDwellMinutes: 2 }, null), 120);
});

// ── Backfill ─────────────────────────────────────────────────────────────────

test("a delayed run backfills the clock-in to the scheduled start", () => {
  const decision = decideArrivalClockIn(input({ now: "2026-07-21T13:30:00.000Z" }));
  assert.equal(decision.action, "clock_in");
  // Written at 7:00 local, not at the 9:30 processing time.
  assert.equal(decision.action === "clock_in" && decision.effectiveAt, SHIFT_START);
  assert.equal(decision.action === "clock_in" && decision.backfilled, true);
  assert.equal(decision.action === "clock_in" && decision.method, "scheduled_start_backfilled");
});

test("a run within the tick interval is not treated as a backfill", () => {
  const decision = decideArrivalClockIn(input({ now: "2026-07-21T11:00:30.000Z" }));
  assert.equal(decision.action === "clock_in" && decision.backfilled, false);
});

test("an arrival stale beyond the backfill ceiling is skipped, not resurrected", () => {
  const wayLater = new Date(Date.parse(SHIFT_START) + (DEFAULT_MAX_BACKFILL_MINUTES + 60) * 60_000);
  const decision = decideArrivalClockIn(input({ now: wayLater.toISOString() }));
  assert.equal(decision.action, "skip");
  assert.equal(decision.action === "skip" && decision.reason, "outside_backfill_window");
});

// ── Conflicting jobs ─────────────────────────────────────────────────────────

test("clock-in is refused while the employee is clocked into another job", () => {
  const decision = decideArrivalClockIn(input({ openElsewhereJobId: "job-other" }));
  assert.equal(decision.action, "skip");
  assert.equal(decision.action === "skip" && decision.reason, "clocked_in_elsewhere");
});

test("a job that is already pending departure does not block the next job", () => {
  const blocking = buildOpenElsewhere([
    { user_id: "u1", job_id: "job-a", clock_in_at: "2026-07-21T11:00:00.000Z", pending_departure_at: null },
  ]);
  assert.equal(blocking.get("u1"), "job-a");

  const resolving = buildOpenElsewhere([
    {
      user_id: "u1",
      job_id: "job-a",
      clock_in_at: "2026-07-21T11:00:00.000Z",
      pending_departure_at: "2026-07-21T14:00:00.000Z",
    },
  ]);
  assert.equal(resolving.get("u1"), undefined);

  // A card that never clocked in is not an open clock-in either.
  const pendingOnly = buildOpenElsewhere([
    { user_id: "u1", job_id: "job-a", clock_in_at: null, pending_departure_at: null },
  ]);
  assert.equal(pendingOnly.get("u1"), undefined);
});

// ── A closed record is terminal ──────────────────────────────────────────────

test("a closed timecard is never reopened", () => {
  const decision = decideArrivalClockIn(
    input({
      card: {
        pendingArrivalAt: ARRIVED_0650,
        clockInAt: SHIFT_START,
        clockOutAt: "2026-07-21T20:00:00.000Z",
        onsiteBeforeShiftAt: null,
      },
    })
  );
  assert.equal(decision.action, "skip");
  assert.equal(decision.action === "skip" && decision.reason, "already_closed");
});

// ── Timezone / DST ───────────────────────────────────────────────────────────

const NY_SCHEDULE = {
  timezone: "America/New_York",
  workDays: ["mon", "tue", "wed", "thu", "fri"],
  workStartTime: "07:00",
  workEndTime: "16:00",
  earlyArrivalWindowMinutes: 120,
  lateGraceMinutes: 10,
};

test("scheduled start uses the company timezone, not the server's", () => {
  // 2026-07-21 is a Tuesday. EDT (UTC-4) → 07:00 local = 11:00Z.
  const window = scheduledWindowForWorkDate("2026-07-21", NY_SCHEDULE);
  assert.equal(window.scheduledStart, "2026-07-21T11:00:00.000Z");
  assert.equal(window.scheduledEnd, "2026-07-21T20:00:00.000Z");
  assert.equal(window.isWorkDay, true);
});

test("scheduled start survives the daylight-saving transition", () => {
  // 2026-03-06 is a Friday in EST (UTC-5) → 07:00 local = 12:00Z.
  assert.equal(
    scheduledWindowForWorkDate("2026-03-06", NY_SCHEDULE).scheduledStart,
    "2026-03-06T12:00:00.000Z"
  );
  // 2026-03-08 02:00 springs forward. 2026-03-09 is a Monday in EDT (UTC-4)
  // → the SAME configured "07:00" is now 11:00Z, one hour earlier in UTC.
  assert.equal(
    scheduledWindowForWorkDate("2026-03-09", NY_SCHEDULE).scheduledStart,
    "2026-03-09T11:00:00.000Z"
  );
  // And back again in the fall: 2026-11-02 (Monday) is EST → 12:00Z.
  assert.equal(
    scheduledWindowForWorkDate("2026-11-02", NY_SCHEDULE).scheduledStart,
    "2026-11-02T12:00:00.000Z"
  );
});

test("a non-work day yields no scheduled start", () => {
  // 2026-07-19 is a Sunday.
  const window = scheduledWindowForWorkDate("2026-07-19", NY_SCHEDULE);
  assert.equal(window.isWorkDay, false);
  assert.equal(window.scheduledStart, null);
});

test("a malformed work date never invents a schedule", () => {
  assert.equal(scheduledWindowForWorkDate("not-a-date", NY_SCHEDULE).scheduledStart, null);
});

// ── resolveScheduledStart ────────────────────────────────────────────────────

test("the stored scheduled start wins over the company default", () => {
  const stored = resolveScheduledStart(
    { scheduled_start: "2026-07-21T13:00:00.000Z", work_date: "2026-07-21" },
    { timezone: "America/New_York", default_work_days: "mon,tue,wed,thu,fri", default_work_start_time: "07:00", default_work_end_time: "16:00" }
  );
  assert.equal(stored, "2026-07-21T13:00:00.000Z");
});

test("a timecard without a stored start falls back to the company work hours", () => {
  const derived = resolveScheduledStart(
    { scheduled_start: null, work_date: "2026-07-21" },
    {
      timezone: "America/New_York",
      default_work_days: "mon,tue,wed,thu,fri",
      default_work_start_time: "07:00",
      default_work_end_time: "16:00",
    }
  );
  assert.equal(derived, "2026-07-21T11:00:00.000Z");
});

test("no configured work hours means no invented scheduled start", () => {
  assert.equal(resolveScheduledStart({ scheduled_start: null, work_date: "2026-07-21" }, null), null);
  assert.equal(
    resolveScheduledStart({ scheduled_start: null, work_date: "2026-07-21" }, { timezone: "America/New_York" }),
    null
  );
});
