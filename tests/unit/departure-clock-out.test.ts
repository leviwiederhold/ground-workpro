import test from "node:test";
import assert from "node:assert/strict";
import {
  decideClockOut,
  DEFAULT_MAX_CLOCK_OUT_BACKFILL_MINUTES,
  type ClockOutInput,
} from "../../src/lib/attendance/departure.ts";
import { computeMonitoringPlan, type MonitoringDay } from "../../src/lib/attendance/monitoringPlan.ts";
import { resolveDepartureGraceMinutes } from "../../src/lib/attendance/attendanceSettings.ts";

// 7:00 AM – 4:00 PM shift, America/New_York in July (UTC-4).
const CLOCK_IN = "2026-07-21T11:00:00.000Z";
const SHIFT_END = "2026-07-21T20:00:00.000Z";
const EXITED_1400 = "2026-07-21T18:00:00.000Z"; // 2:00 PM local

function input(over: Partial<ClockOutInput> = {}): ClockOutInput {
  return {
    now: "2026-07-21T18:11:00.000Z",
    card: { clockInAt: CLOCK_IN, clockOutAt: null, pendingDepartureAt: EXITED_1400 },
    departureGraceMinutes: 10,
    ...over,
  };
}

// ── Brief exits do not clock the employee out ────────────────────────────────

test("inside the grace period the shift is held open", () => {
  const decision = decideClockOut(input({ now: "2026-07-21T18:05:00.000Z" }));
  assert.equal(decision.action, "hold");
  assert.equal(decision.action === "hold" && decision.reason, "within_grace");
  assert.equal(decision.action === "hold" && decision.graceEndsAt, "2026-07-21T18:10:00.000Z");
});

test("returning during the grace period cancels the pending departure", () => {
  const decision = decideClockOut(
    input({ now: "2026-07-21T18:20:00.000Z", lastEnterAt: "2026-07-21T18:04:00.000Z" })
  );
  assert.equal(decision.action, "cancel_departure");
  assert.equal(decision.action === "cancel_departure" && decision.returnedAt, "2026-07-21T18:04:00.000Z");
});

test("a return AFTER the grace period does not resurrect the shift", () => {
  // The departure was already confirmed at 14:10; a 14:30 re-entry is a new
  // arrival, not a cancellation.
  const decision = decideClockOut(
    input({ now: "2026-07-21T18:35:00.000Z", lastEnterAt: "2026-07-21T18:30:00.000Z" })
  );
  assert.equal(decision.action, "clock_out");
});

test("a re-entry recorded BEFORE the exit is not a return", () => {
  const decision = decideClockOut(input({ lastEnterAt: CLOCK_IN }));
  assert.equal(decision.action, "clock_out");
});

// ── A confirmed departure creates exactly one clock-out ──────────────────────

test("a confirmed departure clocks out at the ORIGINAL exit time", () => {
  const decision = decideClockOut(input());
  assert.equal(decision.action, "clock_out");
  assert.equal(decision.action === "clock_out" && decision.effectiveAt, EXITED_1400);
  assert.equal(decision.action === "clock_out" && decision.method, "departure_grace");
});

test("a delayed or offline confirmation still uses the original departure time", () => {
  // Processed three hours late — the timecard must not absorb those hours.
  const decision = decideClockOut(input({ now: "2026-07-21T21:00:00.000Z" }));
  assert.equal(decision.action === "clock_out" && decision.effectiveAt, EXITED_1400);
  assert.equal(decision.action === "clock_out" && decision.backfilled, true);
});

test("an already-closed timecard is never clocked out twice", () => {
  const decision = decideClockOut(
    input({ card: { clockInAt: CLOCK_IN, clockOutAt: EXITED_1400, pendingDepartureAt: null } })
  );
  assert.equal(decision.action, "skip");
  assert.equal(decision.action === "skip" && decision.reason, "already_clocked_out");
});

test("a record that never clocked in has nothing to close", () => {
  const decision = decideClockOut(
    input({ card: { clockInAt: null, clockOutAt: null, pendingDepartureAt: EXITED_1400 } })
  );
  assert.equal(decision.action, "skip");
  assert.equal(decision.action === "skip" && decision.reason, "not_clocked_in");
});

test("a departure stale beyond the ceiling is left for a manager, not guessed", () => {
  const wayLater = new Date(
    Date.parse(EXITED_1400) + (DEFAULT_MAX_CLOCK_OUT_BACKFILL_MINUTES + 60) * 60_000
  ).toISOString();
  const decision = decideClockOut(input({ now: wayLater }));
  assert.equal(decision.action, "skip");
  assert.equal(decision.action === "skip" && decision.reason, "outside_backfill_window");
});

test("a zero grace period clocks out immediately on the exit", () => {
  const decision = decideClockOut(input({ departureGraceMinutes: 0, now: EXITED_1400 }));
  assert.equal(decision.action, "clock_out");
  assert.equal(decision.action === "clock_out" && decision.effectiveAt, EXITED_1400);
});

// ── End-of-day reconciliation for a missed exit event ────────────────────────

test("no exit event: the shift stays open until the end-of-day cutoff", () => {
  const decision = decideClockOut(
    input({
      now: "2026-07-21T21:00:00.000Z", // 5:00 PM, only 1h past the 4:00 PM end
      card: { clockInAt: CLOCK_IN, clockOutAt: null, pendingDepartureAt: null },
      scheduledEnd: SHIFT_END,
      endOfDayCutoffMinutes: 180,
    })
  );
  assert.equal(decision.action, "skip");
  assert.equal(decision.action === "skip" && decision.reason, "no_departure");
});

test("no exit event: past the cutoff the shift is closed at the scheduled end", () => {
  const decision = decideClockOut(
    input({
      now: "2026-07-21T23:30:00.000Z", // 7:30 PM, past the 3h cutoff
      card: { clockInAt: CLOCK_IN, clockOutAt: null, pendingDepartureAt: null },
      scheduledEnd: SHIFT_END,
      endOfDayCutoffMinutes: 180,
    })
  );
  assert.equal(decision.action, "clock_out");
  assert.equal(decision.action === "clock_out" && decision.effectiveAt, SHIFT_END);
  assert.equal(decision.action === "clock_out" && decision.method, "fallback_end_of_day");
});

test("the fallback never closes a shift before it started", () => {
  const lateClockIn = "2026-07-21T21:00:00.000Z"; // clocked in after the shift end
  const decision = decideClockOut(
    input({
      now: "2026-07-22T06:00:00.000Z",
      card: { clockInAt: lateClockIn, clockOutAt: null, pendingDepartureAt: null },
      scheduledEnd: SHIFT_END,
      endOfDayCutoffMinutes: 180,
    })
  );
  assert.equal(decision.action === "clock_out" && decision.effectiveAt, lateClockIn);
});

test("with no schedule there is no boundary to guess, so nothing is closed", () => {
  const decision = decideClockOut(
    input({
      now: "2026-07-25T00:00:00.000Z",
      card: { clockInAt: CLOCK_IN, clockOutAt: null, pendingDepartureAt: null },
      scheduledEnd: null,
      endOfDayCutoffMinutes: 180,
    })
  );
  assert.equal(decision.action, "skip");
  assert.equal(decision.action === "skip" && decision.reason, "no_departure");
});

test("a zero cutoff disables the fallback entirely", () => {
  const decision = decideClockOut(
    input({
      now: "2026-07-25T00:00:00.000Z",
      card: { clockInAt: CLOCK_IN, clockOutAt: null, pendingDepartureAt: null },
      scheduledEnd: SHIFT_END,
      endOfDayCutoffMinutes: 0,
    })
  );
  assert.equal(decision.action, "skip");
});

// ── Grace-period resolution ──────────────────────────────────────────────────

test("the enforced grace period is the longer of the two company knobs", () => {
  assert.equal(resolveDepartureGraceMinutes({ departureGraceMinutes: 10 }, 5), 10);
  assert.equal(resolveDepartureGraceMinutes({ departureGraceMinutes: 3 }, 5), 5);
  assert.equal(resolveDepartureGraceMinutes({ departureGraceMinutes: 10 }, null), 10);
});

// ── Monitoring lifecycle ─────────────────────────────────────────────────────

function day(over: Partial<MonitoringDay> = {}): MonitoringDay {
  return {
    workDate: "2026-07-21",
    scheduledStart: CLOCK_IN,
    scheduledEnd: SHIFT_END,
    resolved: false,
    ...over,
  };
}

const TOMORROW = day({
  workDate: "2026-07-22",
  scheduledStart: "2026-07-22T11:00:00.000Z",
  scheduledEnd: "2026-07-22T20:00:00.000Z",
});

function planInput(over: Partial<Parameters<typeof computeMonitoringPlan>[0]> = {}) {
  return {
    now: "2026-07-21T12:00:00.000Z",
    days: [day(), TOMORROW],
    monitoringLeadMinutes: 120,
    endOfDayCutoffMinutes: 180,
    hasMonitorableJob: true,
    ...over,
  };
}

test("monitoring is active inside the window, starting 120 minutes early", () => {
  // Monitoring opens at 09:00Z (5:00 AM local) for an 11:00Z (7:00 AM) start.
  const early = computeMonitoringPlan(planInput({ now: "2026-07-21T09:30:00.000Z" }));
  assert.equal(early.active, true);
  assert.equal(early.windowStartsAt, "2026-07-21T09:00:00.000Z");

  const beforeWindow = computeMonitoringPlan(planInput({ now: "2026-07-21T08:00:00.000Z" }));
  assert.equal(beforeWindow.active, false);
  assert.equal(beforeWindow.inactiveReason, "before_window");
  assert.equal(beforeWindow.nextWindowStartsAt, "2026-07-21T09:00:00.000Z");
});

test("monitoring ends for the workday once it is clocked out", () => {
  const plan = computeMonitoringPlan(planInput({ days: [day({ resolved: true }), TOMORROW] }));
  assert.equal(plan.active, false);
  assert.equal(plan.inactiveReason, "day_resolved");
});

test("the next scheduled workday is still prepared after a clock-out", () => {
  const plan = computeMonitoringPlan(planInput({ days: [day({ resolved: true }), TOMORROW] }));
  assert.equal(plan.nextWorkDate, "2026-07-22");
  // Tomorrow's window opens 120 minutes before its 11:00Z start.
  assert.equal(plan.nextWindowStartsAt, "2026-07-22T09:00:00.000Z");
});

test("the next day activates normally", () => {
  const plan = computeMonitoringPlan(
    planInput({ now: "2026-07-22T09:30:00.000Z", days: [day({ resolved: true }), TOMORROW] })
  );
  assert.equal(plan.active, true);
  assert.equal(plan.nextWorkDate, "2026-07-22");
});

test("no assignment or unverified coordinates means nothing is monitored", () => {
  const plan = computeMonitoringPlan(planInput({ hasMonitorableJob: false }));
  assert.equal(plan.active, false);
  assert.equal(plan.inactiveReason, "no_job");
  assert.equal(plan.nextWindowStartsAt, null);
});

test("no configured schedule is reported as such, not as a closed window", () => {
  const plan = computeMonitoringPlan(
    planInput({ days: [day({ scheduledStart: null, scheduledEnd: null })] })
  );
  assert.equal(plan.active, false);
  assert.equal(plan.inactiveReason, "no_schedule");
});

test("after the last window with nothing ahead, monitoring is simply over", () => {
  const plan = computeMonitoringPlan(planInput({ now: "2026-07-23T00:00:00.000Z" }));
  assert.equal(plan.active, false);
  assert.equal(plan.inactiveReason, "after_window");
  assert.equal(plan.nextWindowStartsAt, null);
});
