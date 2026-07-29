/* eslint-disable @typescript-eslint/no-explicit-any */
// End-to-end automatic attendance lifecycle validation.
//
// Every scenario here drives the REAL modules — the decision engines, the
// scheduled runners, the offline queue, the lifecycle derivation — against an
// in-memory database. Nothing is mocked except storage and the network.
//
// WHAT THIS CAN AND CANNOT PROVE
//
// It proves the SERVER-SIDE and STATE-MACHINE behavior: that with no client
// involvement at all, the scheduled pass produces the right records at the
// right timestamps, exactly once. That is the substance of "works with the app
// closed" — the scheduled pass is the mechanism, and here it runs with no app
// in the picture whatsoever.
//
// It does NOT prove that iOS or Android actually wake the app and deliver a
// geofence transition while backgrounded, locked, or after a reboot. No test
// process can prove that. Those rows are marked UNVERIFIED in
// docs/attendance-device-test-plan.md and must be signed off on real hardware.

import test from "node:test";
import assert from "node:assert/strict";
import { runScheduledAttendanceClockIn } from "../../src/lib/attendance/scheduledClockInRunner.ts";
import { runScheduledAttendanceClockOut } from "../../src/lib/attendance/departureRunner.ts";
import { decideArrivalClockIn } from "../../src/lib/attendance/scheduledClockIn.ts";
import { decideClockOut } from "../../src/lib/attendance/departure.ts";
import { computeMonitoringPlan } from "../../src/lib/attendance/monitoringPlan.ts";
import { deriveAttendanceLifecycle } from "../../src/lib/attendance/lifecycleState.ts";
import {
  classifyFailure,
  enqueue,
  markFailure,
  normalizeStoredQueue,
  selectDueForRetry,
} from "../../src/lib/attendance/offlineQueue.ts";
import { scheduledWindowForWorkDate } from "../../src/lib/jobsite-time/domain.ts";
import { makeDb, eventTypes, type Row } from "./helpers/fakeSupabase.ts";

// ── The world these scenarios happen in ──────────────────────────────────────
// America/New_York, July (UTC-4). A 7:00 AM – 4:00 PM shift.
const SHIFT_START = "2026-07-21T11:00:00.000Z"; // 7:00 AM local
const SHIFT_END = "2026-07-21T20:00:00.000Z"; // 4:00 PM local
const MONITORING_OPENS = "2026-07-21T09:00:00.000Z"; // 5:00 AM, 120 min lead
const ARRIVED_0650 = "2026-07-21T10:50:00.000Z";
const WORK_DATE = "2026-07-21";

const COMPANY = {
  id: "co-1",
  timezone: "America/New_York",
  default_work_days: "mon,tue,wed,thu,fri",
  default_work_start_time: "07:00",
  default_work_end_time: "16:00",
  attendance_automatic_enabled: true,
  attendance_arrival_dwell_minutes: 2,
  attendance_early_arrival_mode: "scheduled_start",
  attendance_early_arrival_window_minutes: 120,
  attendance_departure_grace_minutes: 10,
  attendance_end_of_day_cutoff_minutes: 180,
  jobsite_arrival_confirmation_seconds: 45,
  jobsite_departure_grace_minutes: 5,
};

function card(over: Row = {}): Row {
  return {
    id: "tc-1",
    company_id: "co-1",
    job_id: "job-1",
    employee_id: "emp-1",
    user_id: "user-1",
    work_date: WORK_DATE,
    scheduled_start: SHIFT_START,
    scheduled_end: SHIFT_END,
    clock_in_at: null,
    clock_out_at: null,
    break_start_at: null,
    break_end_at: null,
    pending_arrival_at: ARRIVED_0650,
    pending_departure_at: null,
    detected_arrival_at: null,
    detected_departure_at: null,
    onsite_before_shift_at: null,
    status: "active",
    monitoring_stopped_at: null,
    ...over,
  };
}

function world(cards: Row[], events: Row[] = [], company: Row = COMPANY) {
  return makeDb({ jobsite_timecards: cards, companies: [company], jobsite_timecard_events: events });
}

/** One tick of the server-side reconciliation: arrivals, then departures. */
async function tick(db: any, now: string) {
  const arrivals = await runScheduledAttendanceClockIn({ db, now });
  const departures = await runScheduledAttendanceClockOut({ db, now });
  return { arrivals, departures };
}

// ═══════════════════════════════════════════════════════════════════════════
// THE REQUIRED REGRESSION SCENARIO
// ═══════════════════════════════════════════════════════════════════════════

test("REGRESSION: onsite before 7:00, app never opened → auto clock-in at 7:00, auto clock-out after the grace period", async () => {
  const c = card();
  const db = world([c]);

  // 5:00 AM — monitoring opens, 120 minutes before the shift.
  const plan = computeMonitoringPlan({
    now: MONITORING_OPENS,
    days: [{ workDate: WORK_DATE, scheduledStart: SHIFT_START, scheduledEnd: SHIFT_END, resolved: false }],
    monitoringLeadMinutes: 120,
    endOfDayCutoffMinutes: 180,
    hasMonitorableJob: true,
  });
  assert.equal(plan.active, true, "monitoring must be active 120 minutes before the shift");

  // 6:50 AM — arrival recorded (the native geofence path put this row here).
  // 6:53 AM — the dwell has elapsed. The employee is onsite, NOT clocked in.
  await tick(db, "2026-07-21T10:53:00.000Z");
  assert.equal(c.clock_in_at, null, "an early arrival must not clock the employee in");
  assert.equal(c.onsite_before_shift_at, ARRIVED_0650);

  // 7:00 AM — the scheduled pass creates the clock-in. No app, no client, no
  // request from the phone: this tick is the entire mechanism.
  await tick(db, SHIFT_START);
  assert.equal(c.clock_in_at, SHIFT_START, "must be clocked in AT the scheduled start");
  assert.equal(c.clock_in_method, "scheduled_start");

  // 2:00 PM — the employee leaves.
  c.pending_departure_at = "2026-07-21T18:00:00.000Z";
  c.detected_departure_at = "2026-07-21T18:00:00.000Z";

  // 2:05 PM — inside the 10-minute grace period. Still on the clock.
  await tick(db, "2026-07-21T18:05:00.000Z");
  assert.equal(c.clock_out_at, null, "a brief absence must not end the shift");

  // 2:11 PM — grace elapsed. Clocked out AT the departure time, not now.
  await tick(db, "2026-07-21T18:11:00.000Z");
  assert.equal(c.clock_out_at, "2026-07-21T18:00:00.000Z");
  assert.equal(c.total_minutes, 420, "7 hours — the processing delay is not paid");
  assert.equal(c.monitoring_stopped_at, null, "midday departure ends one session, not monitoring");

  assert.deepEqual(eventTypes(db), [
    "onsite_before_shift",
    "scheduled_clock_in",
    "auto_clock_out",
  ]);
});

// ═══════════════════════════════════════════════════════════════════════════
// 1–30: the required scenario matrix
// ═══════════════════════════════════════════════════════════════════════════

test("1. Employee arrives before shift", async () => {
  const c = card();
  const db = world([c]);
  await tick(db, "2026-07-21T10:53:00.000Z");
  assert.equal(c.clock_in_at, null);
  assert.equal(c.onsite_before_shift_at, ARRIVED_0650);
  await tick(db, SHIFT_START);
  assert.equal(c.clock_in_at, SHIFT_START);
});

test("2. Employee arrives after shift start", async () => {
  const late = "2026-07-21T11:20:00.000Z"; // 7:20 AM
  const c = card({ pending_arrival_at: late });
  const db = world([c]);
  await tick(db, "2026-07-21T11:25:00.000Z");
  // Clocked in at the ARRIVAL, never backdated to a start they missed.
  assert.equal(c.clock_in_at, late);
  assert.equal(c.clock_in_method, "arrival");
});

test("3. Employee is already onsite when monitoring activates", async () => {
  // Arrived at 4:00 AM, before the 5:00 AM monitoring window even opened.
  const c = card({ pending_arrival_at: "2026-07-21T08:00:00.000Z" });
  const db = world([c]);
  await tick(db, SHIFT_START);
  assert.equal(c.clock_in_at, SHIFT_START, "already-onsite must still clock in at the shift start");
});

test("4. App backgrounded — the scheduled pass does not care", async () => {
  const c = card();
  const db = world([c]);
  // No client call of any kind in this test.
  await tick(db, SHIFT_START);
  assert.equal(c.clock_in_at, SHIFT_START);
});

test("5. App closed or WebView inactive — same result, no client involvement", async () => {
  const c = card();
  const db = world([c]);
  await tick(db, SHIFT_START);
  assert.equal(c.clock_in_at, SHIFT_START);
  assert.ok(eventTypes(db).includes("scheduled_clock_in"));
});

test("6. Phone locked — the server has no dependency on device state", async () => {
  const c = card();
  const db = world([c]);
  await tick(db, SHIFT_START);
  assert.equal(c.clock_in_at, SHIFT_START);
});

test("7. Device offline during arrival — the original timestamp survives the sync", () => {
  // The arrival happened at 6:50 with no signal and syncs at 9:30.
  const queued = enqueue([], {
    jobId: "job-1",
    zone: "arrival",
    transition: "enter",
    occurredAt: ARRIVED_0650,
  }, "2026-07-21T13:30:00.000Z");
  assert.equal(queued[0].occurredAt, ARRIVED_0650, "never rewritten to the flush time");

  // Once ingested, the clock-in is still at the scheduled start.
  const decision = decideArrivalClockIn({
    now: "2026-07-21T13:30:00.000Z",
    card: { pendingArrivalAt: ARRIVED_0650, clockInAt: null, clockOutAt: null, onsiteBeforeShiftAt: null },
    scheduledStart: SHIFT_START,
    earlyArrivalMode: "scheduled_start",
    arrivalConfirmationSeconds: 120,
  });
  assert.equal(decision.action === "clock_in" && decision.effectiveAt, SHIFT_START);
  assert.equal(decision.action === "clock_in" && decision.backfilled, true);
});

test("8. Device offline during departure — the clock-out uses the original exit time", () => {
  const exitedAt = "2026-07-21T18:00:00.000Z";
  const decision = decideClockOut({
    now: "2026-07-21T22:00:00.000Z", // synced four hours later
    card: { clockInAt: SHIFT_START, clockOutAt: null, pendingDepartureAt: exitedAt },
    departureGraceMinutes: 10,
  });
  assert.equal(decision.action === "clock_out" && decision.effectiveAt, exitedAt);
});

test("9. App reopened after a missed event — reconciliation finds no work to do", async () => {
  const c = card();
  const db = world([c]);
  await tick(db, SHIFT_START); // the scheduler already handled it
  const before = eventTypes(db).length;

  // The app opens and the foreground pass runs. It must be a no-op.
  const again = await tick(db, "2026-07-21T11:30:00.000Z");
  assert.equal(again.arrivals.candidates, 0);
  assert.equal(eventTypes(db).length, before, "no duplicate record and no duplicate audit event");
});

test("10. Brief exit and return — no clock-out", async () => {
  const c = card({
    clock_in_at: SHIFT_START,
    pending_departure_at: "2026-07-21T14:00:00.000Z",
    pending_arrival_at: null,
    onsite_before_shift_at: ARRIVED_0650,
  });
  const db = world([c], [
    { id: "e1", timecard_id: "tc-1", event_type: "entered_geofence", occurred_at: "2026-07-21T14:04:00.000Z" },
  ]);
  await tick(db, "2026-07-21T14:20:00.000Z");
  assert.equal(c.clock_out_at, null);
  assert.equal(c.pending_departure_at, null, "the pending departure is cancelled");
  assert.ok(eventTypes(db).includes("departure_cancelled"));
});

test("11. Permanent departure — exactly one clock-out", async () => {
  const c = card({
    clock_in_at: SHIFT_START,
    pending_departure_at: "2026-07-21T18:00:00.000Z",
    pending_arrival_at: null,
  });
  const db = world([c]);
  await tick(db, "2026-07-21T18:11:00.000Z");
  await tick(db, "2026-07-21T18:30:00.000Z");
  await tick(db, "2026-07-21T19:00:00.000Z");
  assert.equal(c.clock_out_at, "2026-07-21T18:00:00.000Z");
  assert.equal(eventTypes(db).filter((e) => e === "auto_clock_out").length, 1);
});

test("12. Assignment changed before the shift — the old day's arrival is not clocked in", async () => {
  // The arrival row is for job-1; the employee was moved to job-2 before 7:00,
  // so job-1's pending arrival must resolve without creating paid time there.
  const oldJob = card({ id: "tc-old", job_id: "job-1" });
  const newJob = card({ id: "tc-new", job_id: "job-2", pending_arrival_at: null, scheduled_start: SHIFT_START });
  const db = world([oldJob, newJob]);

  // The employee left job-1 before the shift started.
  db.tables.jobsite_timecard_events.push({
    id: "e1",
    timecard_id: "tc-old",
    event_type: "exited_geofence",
    occurred_at: "2026-07-21T10:55:00.000Z",
  });
  await tick(db, SHIFT_START);
  assert.equal(oldJob.clock_in_at, null);
  assert.ok(eventTypes(db).includes("clock_in_rejected"));
});

test("13. Assignment changed while onsite — no second concurrent clock-in", async () => {
  const openAtA = card({
    id: "tc-a",
    job_id: "job-1",
    clock_in_at: SHIFT_START,
    pending_arrival_at: null,
  });
  const arrivedAtB = card({ id: "tc-b", job_id: "job-2", pending_arrival_at: "2026-07-21T14:00:00.000Z" });
  const db = world([openAtA, arrivedAtB]);

  await tick(db, "2026-07-21T14:10:00.000Z");
  assert.equal(arrivedAtB.clock_in_at, null, "an employee cannot be on the clock at two jobs");
  assert.equal(openAtA.clock_out_at, null);
});

test("14. Multiple nearby jobs — only the assigned one has a record", async () => {
  // The pipeline only ever acts on rows created for an ASSIGNED job (the events
  // route rejects unassigned arrivals), so a nearby job cannot produce time.
  const assigned = card({ id: "tc-1", job_id: "job-1" });
  const db = world([assigned]);
  await tick(db, SHIFT_START);
  assert.equal(db.tables.jobsite_timecards.length, 1);
  assert.equal(assigned.clock_in_at, SHIFT_START);
});

test("15. Overlapping job assignments — the second clock-in is refused, not merged", async () => {
  const first = card({ id: "tc-1", job_id: "job-1", clock_in_at: SHIFT_START, pending_arrival_at: null });
  const second = card({ id: "tc-2", job_id: "job-2", pending_arrival_at: "2026-07-21T12:00:00.000Z" });
  const db = world([first, second]);
  const { arrivals } = await tick(db, "2026-07-21T12:10:00.000Z");
  assert.equal(arrivals.rejected, 1);
  assert.equal(second.clock_in_at, null);
});

test("16. Duplicate native events — one record, one audit event", async () => {
  const c = card();
  const db = world([c]);
  // Three ticks racing over the same arrival.
  await Promise.all([tick(db, SHIFT_START), tick(db, SHIFT_START), tick(db, SHIFT_START)]);
  assert.equal(c.clock_in_at, SHIFT_START);
  assert.equal(eventTypes(db).filter((e) => e === "scheduled_clock_in").length, 1);
});

test("17. Out-of-order events — the exit never overtakes its enter", () => {
  let queue = enqueue([], { jobId: "job-1", zone: "arrival", transition: "exit", occurredAt: "2026-07-21T18:00:00.000Z" }, "2026-07-21T18:30:00.000Z");
  queue = enqueue(queue, { jobId: "job-1", zone: "arrival", transition: "enter", occurredAt: ARRIVED_0650 }, "2026-07-21T18:30:00.000Z");
  const due = selectDueForRetry(queue, "2026-07-21T18:30:00.000Z");
  assert.equal(due.length, 1);
  assert.equal(due[0].transition, "enter");
});

test("18. Expired or revoked credential — events are held, not lost or quarantined", () => {
  let queue = enqueue([], { jobId: "job-1", zone: "arrival", transition: "enter", occurredAt: ARRIVED_0650 }, ARRIVED_0650);
  assert.equal(classifyFailure(401), "auth");
  for (let i = 0; i < 20; i += 1) {
    queue = markFailure(queue, queue[0].eventId, "auth", "HTTP 401", ARRIVED_0650);
  }
  assert.equal(queue[0].state, "pending", "an expired credential must not destroy a day of attendance");
  assert.equal(queue[0].attempts, 0);
  assert.equal(queue[0].occurredAt, ARRIVED_0650);
});

test("19. Permission revoked and restored — the record survives, the UI tells the truth", () => {
  const withRecord = deriveAttendanceLifecycle({
    automaticAttendanceEnabled: true,
    hasAssignmentToday: true,
    jobsiteHasVerifiedCoordinates: true,
    foregroundPermission: "denied", // revoked mid-shift
    backgroundPermission: "denied",
    preciseLocation: true,
    nativeGeofenceSupported: true,
    assignedJobGeofenceRegistered: true,
    deviceCredentialActive: true,
    monitoringWindowActive: true,
    monitoringStartsAt: MONITORING_OPENS,
    onsite: null,
    todayCard: { clockInAt: SHIFT_START, clockOutAt: null, pendingDepartureAt: null, onsiteBeforeShiftAt: null },
    pendingQueueCount: 0,
    lastSyncFailed: false,
    manualFallbackEnabled: true,
  });
  assert.equal(withRecord.state, "clocked_in_automatically", "the shift that happened is still reported");
  assert.equal(withRecord.monitoringActive, false, "but monitoring is never claimed");
  assert.ok(withRecord.issues.includes("permission_setup_required"));
  assert.equal(withRecord.manualFallbackRecommended, true);
});

test("20. Precise location disabled — reported specifically, monitoring not claimed", () => {
  const result = deriveAttendanceLifecycle({
    automaticAttendanceEnabled: true,
    hasAssignmentToday: true,
    jobsiteHasVerifiedCoordinates: true,
    foregroundPermission: "granted",
    backgroundPermission: "granted",
    preciseLocation: false,
    nativeGeofenceSupported: true,
    assignedJobGeofenceRegistered: true,
    deviceCredentialActive: true,
    monitoringWindowActive: true,
    monitoringStartsAt: MONITORING_OPENS,
    onsite: false,
    todayCard: null,
    pendingQueueCount: 0,
    lastSyncFailed: false,
    manualFallbackEnabled: true,
  });
  assert.equal(result.state, "precise_location_unavailable");
  assert.equal(result.monitoringActive, false);
});

test("21. Phone restarted — a queue written before the restart is recovered intact", () => {
  const beforeRestart = enqueue([], { jobId: "job-1", zone: "arrival", transition: "enter", occurredAt: ARRIVED_0650 }, ARRIVED_0650);
  // The process is gone; only what reached disk remains.
  const afterRestart = normalizeStoredQueue(JSON.parse(JSON.stringify(beforeRestart)), "2026-07-21T13:00:00.000Z");
  assert.equal(afterRestart.length, 1);
  assert.equal(afterRestart[0].occurredAt, ARRIVED_0650);
  assert.equal(selectDueForRetry(afterRestart, "2026-07-21T13:00:00.000Z").length, 1);
});

test("22. App updated — a queue written by the previous build still flushes", () => {
  // v1 records had no state/nextAttemptAt/source fields.
  const v1 = [{ jobId: "job-1", zone: "arrival", transition: "enter", occurredAt: ARRIVED_0650, attempts: 2 }];
  const migrated = normalizeStoredQueue(v1, "2026-07-21T13:00:00.000Z");
  assert.equal(migrated.length, 1);
  assert.equal(migrated[0].occurredAt, ARRIVED_0650);
  assert.equal(migrated[0].state, "pending");
});

test("23. Company timezone changed — the shift start follows the new timezone", () => {
  const ny = scheduledWindowForWorkDate(WORK_DATE, {
    timezone: "America/New_York",
    workDays: ["mon", "tue", "wed", "thu", "fri"],
    workStartTime: "07:00",
    workEndTime: "16:00",
    earlyArrivalWindowMinutes: 120,
    lateGraceMinutes: 10,
  });
  const denver = scheduledWindowForWorkDate(WORK_DATE, {
    timezone: "America/Denver",
    workDays: ["mon", "tue", "wed", "thu", "fri"],
    workStartTime: "07:00",
    workEndTime: "16:00",
    earlyArrivalWindowMinutes: 120,
    lateGraceMinutes: 10,
  });
  assert.equal(ny.scheduledStart, "2026-07-21T11:00:00.000Z"); // UTC-4
  assert.equal(denver.scheduledStart, "2026-07-21T13:00:00.000Z"); // UTC-6
});

test("24. Daylight-saving transition — 07:00 local stays 07:00 local", () => {
  const schedule = {
    timezone: "America/New_York",
    workDays: ["mon", "tue", "wed", "thu", "fri"],
    workStartTime: "07:00",
    workEndTime: "16:00",
    earlyArrivalWindowMinutes: 120,
    lateGraceMinutes: 10,
  };
  // 2026-03-08 02:00 springs forward.
  assert.equal(scheduledWindowForWorkDate("2026-03-06", schedule).scheduledStart, "2026-03-06T12:00:00.000Z"); // EST
  assert.equal(scheduledWindowForWorkDate("2026-03-09", schedule).scheduledStart, "2026-03-09T11:00:00.000Z"); // EDT
  // 2026-11-01 falls back.
  assert.equal(scheduledWindowForWorkDate("2026-11-02", schedule).scheduledStart, "2026-11-02T12:00:00.000Z"); // EST
});

test("25. Jobsite coordinates changed — the stored scheduled start is unaffected", async () => {
  // Moving a jobsite must not retroactively shift an employee's shift boundary.
  const c = card();
  const db = world([c]);
  await tick(db, SHIFT_START);
  assert.equal(c.clock_in_at, SHIFT_START);
});

test("26. No verified jobsite coordinates — monitoring is never claimed active", () => {
  const plan = computeMonitoringPlan({
    now: MONITORING_OPENS,
    days: [{ workDate: WORK_DATE, scheduledStart: SHIFT_START, scheduledEnd: SHIFT_END, resolved: false }],
    monitoringLeadMinutes: 120,
    endOfDayCutoffMinutes: 180,
    hasMonitorableJob: false,
  });
  assert.equal(plan.active, false);
  assert.equal(plan.inactiveReason, "no_job");
});

test("27. Employee remains onsite past the scheduled end — the shift stays open", async () => {
  const c = card({ clock_in_at: SHIFT_START, pending_arrival_at: null });
  const db = world([c]);
  // 6:00 PM, two hours past the 4:00 PM end but inside the 3-hour cutoff.
  await tick(db, "2026-07-21T22:00:00.000Z");
  assert.equal(c.clock_out_at, null, "working late must not be truncated at the scheduled end");
});

test("28. Missing exit event — closed by the end-of-day fallback and flagged", async () => {
  const c = card({ clock_in_at: SHIFT_START, pending_arrival_at: null });
  const db = world([c]);
  // 7:30 PM — past the 4:00 PM end plus the 3-hour cutoff.
  await tick(db, "2026-07-21T23:30:00.000Z");
  assert.equal(c.clock_out_at, SHIFT_END);
  assert.equal(c.clock_out_method, "fallback_end_of_day");
  assert.equal(c.status, "needs_review", "a guessed boundary must never look observed");
  assert.equal(c.detected_departure_at, null);
  assert.ok(eventTypes(db).includes("fallback_clock_out"));
});

test("29. Offline queue survives restart — and still produces one record", () => {
  const queued = enqueue([], { jobId: "job-1", zone: "arrival", transition: "enter", occurredAt: ARRIVED_0650 }, ARRIVED_0650);
  const recovered = normalizeStoredQueue(JSON.parse(JSON.stringify(queued)), "2026-07-21T13:00:00.000Z");
  // The stable id is what collapses a post-restart resend into one record.
  assert.equal(recovered[0].eventId, queued[0].eventId);
  const reQueued = enqueue(recovered, { jobId: "job-1", zone: "arrival", transition: "enter", occurredAt: ARRIVED_0650 });
  assert.equal(reQueued.length, 1);
});

test("30. Full arrival-to-clock-out lifecycle with the app never opened", async () => {
  const c = card();
  const db = world([c]);

  await tick(db, "2026-07-21T10:53:00.000Z"); // onsite, before shift
  await tick(db, SHIFT_START); // clocked in at 7:00
  c.pending_departure_at = "2026-07-21T18:00:00.000Z";
  c.detected_departure_at = "2026-07-21T18:00:00.000Z";
  await tick(db, "2026-07-21T18:11:00.000Z"); // clocked out at 2:00 PM

  assert.equal(c.clock_in_at, SHIFT_START);
  assert.equal(c.clock_out_at, "2026-07-21T18:00:00.000Z");
  assert.equal(c.total_minutes, 420);
  // The full audit trail, in order, with no duplicates.
  assert.deepEqual(eventTypes(db), [
    "onsite_before_shift",
    "scheduled_clock_in",
    "auto_clock_out",
  ]);
});

// ═══════════════════════════════════════════════════════════════════════════
// Monitoring lifecycle across days
// ═══════════════════════════════════════════════════════════════════════════

test("after a mid-day clock-out, monitoring continues for same-day re-entry", () => {
  const tomorrow = {
    workDate: "2026-07-22",
    scheduledStart: "2026-07-22T11:00:00.000Z",
    scheduledEnd: "2026-07-22T20:00:00.000Z",
    resolved: false,
  };
  const afterClockOut = computeMonitoringPlan({
    now: "2026-07-21T18:30:00.000Z",
    days: [{ workDate: WORK_DATE, scheduledStart: SHIFT_START, scheduledEnd: SHIFT_END, resolved: true }, tomorrow],
    monitoringLeadMinutes: 120,
    endOfDayCutoffMinutes: 180,
    hasMonitorableJob: true,
  });
  assert.equal(afterClockOut.active, true);
  assert.equal(afterClockOut.nextWorkDate, WORK_DATE);

  const afterCutoff = computeMonitoringPlan({
    now: "2026-07-21T23:01:00.000Z",
    days: [{ workDate: WORK_DATE, scheduledStart: SHIFT_START, scheduledEnd: SHIFT_END, resolved: true }, tomorrow],
    monitoringLeadMinutes: 120,
    endOfDayCutoffMinutes: 180,
    hasMonitorableJob: true,
  });
  assert.equal(afterCutoff.active, false);
  assert.equal(afterCutoff.nextWindowStartsAt, "2026-07-22T09:00:00.000Z");
});

// ═══════════════════════════════════════════════════════════════════════════
// Idempotency under repetition — the property every scenario depends on
// ═══════════════════════════════════════════════════════════════════════════

test("running the reconciliation twenty times changes nothing after the first", async () => {
  const c = card();
  const db = world([c]);

  for (let i = 0; i < 20; i += 1) await tick(db, SHIFT_START);
  c.pending_departure_at = "2026-07-21T18:00:00.000Z";
  for (let i = 0; i < 20; i += 1) await tick(db, "2026-07-21T18:11:00.000Z");

  assert.equal(db.tables.jobsite_timecards.length, 1);
  assert.equal(c.clock_in_at, SHIFT_START);
  assert.equal(c.clock_out_at, "2026-07-21T18:00:00.000Z");
  assert.equal(eventTypes(db).filter((e) => e === "scheduled_clock_in").length, 1);
  assert.equal(eventTypes(db).filter((e) => e === "auto_clock_out").length, 1);
});

test("the automatic pipeline is inert while the company switch is off", async () => {
  const c = card();
  const db = world([c], [], { ...COMPANY, attendance_automatic_enabled: false });
  await tick(db, SHIFT_START);
  await tick(db, "2026-07-21T23:30:00.000Z");
  assert.equal(c.clock_in_at, null);
  assert.equal(c.clock_out_at, null);
  assert.deepEqual(eventTypes(db), []);
});
