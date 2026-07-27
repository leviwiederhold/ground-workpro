import test from "node:test";
import assert from "node:assert/strict";
import { runScheduledAttendanceClockOut } from "../../src/lib/attendance/departureRunner.ts";
import { makeDb, eventTypes, type Row } from "./helpers/fakeSupabase.ts";

// 7:00 AM – 4:00 PM shift, America/New_York in July (UTC-4).
const CLOCK_IN = "2026-07-21T11:00:00.000Z";
const SHIFT_END = "2026-07-21T20:00:00.000Z";
const EXITED_1400 = "2026-07-21T18:00:00.000Z"; // 2:00 PM local

const COMPANY = {
  id: "co-1",
  timezone: "America/New_York",
  default_work_days: "mon,tue,wed,thu,fri",
  default_work_start_time: "07:00",
  default_work_end_time: "16:00",
  attendance_automatic_enabled: true,
  attendance_departure_grace_minutes: 10,
  attendance_end_of_day_cutoff_minutes: 180,
  jobsite_departure_grace_minutes: 5,
};

function openCard(over: Row = {}): Row {
  return {
    id: "tc-1",
    company_id: "co-1",
    job_id: "job-1",
    employee_id: "emp-1",
    user_id: "user-1",
    work_date: "2026-07-21",
    scheduled_start: CLOCK_IN,
    scheduled_end: SHIFT_END,
    clock_in_at: CLOCK_IN,
    clock_out_at: null,
    break_start_at: null,
    break_end_at: null,
    pending_departure_at: EXITED_1400,
    detected_departure_at: EXITED_1400,
    status: "active",
    monitoring_stopped_at: null,
    ...over,
  };
}

test("a brief exit inside the grace period does not clock the employee out", async () => {
  const card = openCard();
  const db = makeDb({ jobsite_timecards: [card], companies: [COMPANY], jobsite_timecard_events: [] });

  const summary = await runScheduledAttendanceClockOut({ db, now: "2026-07-21T18:05:00.000Z" });

  assert.equal(summary.holding, 1);
  assert.equal(summary.clockedOut, 0);
  assert.equal(card.clock_out_at, null);
  assert.deepEqual(eventTypes(db), []);
});

test("a confirmed departure creates exactly one clock-out at the original exit time", async () => {
  const card = openCard();
  const db = makeDb({ jobsite_timecards: [card], companies: [COMPANY], jobsite_timecard_events: [] });

  const summary = await runScheduledAttendanceClockOut({ db, now: "2026-07-21T18:11:00.000Z" });

  assert.equal(summary.clockedOut, 1);
  assert.equal(card.clock_out_at, EXITED_1400);
  assert.equal(card.clock_out_method, "departure_grace");
  assert.equal(card.pending_departure_at, null);
  // 11:00Z → 18:00Z is 7 hours; the 11-minute processing delay is not counted.
  assert.equal(card.total_minutes, 420);
  assert.deepEqual(eventTypes(db), ["auto_clock_out", "monitoring_stopped"]);
});

test("a repeat pass after the clock-out produces no duplicate", async () => {
  const card = openCard();
  const db = makeDb({ jobsite_timecards: [card], companies: [COMPANY], jobsite_timecard_events: [] });

  await runScheduledAttendanceClockOut({ db, now: "2026-07-21T18:11:00.000Z" });
  const again = await runScheduledAttendanceClockOut({ db, now: "2026-07-21T18:20:00.000Z" });

  assert.equal(again.candidates, 0);
  assert.equal(db.tables.jobsite_timecards.length, 1);
  assert.deepEqual(eventTypes(db), ["auto_clock_out", "monitoring_stopped"]);
});

test("re-entry during the grace period cancels the pending departure", async () => {
  const card = openCard();
  const db = makeDb({
    jobsite_timecards: [card],
    companies: [COMPANY],
    jobsite_timecard_events: [
      { id: "e1", timecard_id: "tc-1", event_type: "entered_geofence", occurred_at: "2026-07-21T18:06:00.000Z" },
    ],
  });

  const summary = await runScheduledAttendanceClockOut({ db, now: "2026-07-21T18:20:00.000Z" });

  assert.equal(summary.cancelled, 1);
  assert.equal(summary.clockedOut, 0);
  assert.equal(card.clock_out_at, null);
  assert.equal(card.pending_departure_at, null);
  assert.ok(eventTypes(db).includes("departure_cancelled"));
});

test("monitoring ends for the resolved workday after clock-out", async () => {
  const card = openCard();
  const db = makeDb({ jobsite_timecards: [card], companies: [COMPANY], jobsite_timecard_events: [] });

  const summary = await runScheduledAttendanceClockOut({ db, now: "2026-07-21T18:11:00.000Z" });

  assert.equal(summary.monitoringStopped, 1);
  assert.equal(card.monitoring_stopped_at, "2026-07-21T18:11:00.000Z");
  assert.ok(eventTypes(db).includes("monitoring_stopped"));
});

test("the longer of the two configured grace periods is enforced", async () => {
  // attendance_departure_grace_minutes = 10 wins over the legacy 5.
  const card = openCard();
  const db = makeDb({ jobsite_timecards: [card], companies: [COMPANY], jobsite_timecard_events: [] });

  // 18:07 is past the legacy 5-minute grace but inside the configured 10.
  await runScheduledAttendanceClockOut({ db, now: "2026-07-21T18:07:00.000Z" });
  assert.equal(card.clock_out_at, null);
});

test("a missed exit event is closed at the scheduled end and flagged for review", async () => {
  const card = openCard({ pending_departure_at: null, detected_departure_at: null });
  const db = makeDb({ jobsite_timecards: [card], companies: [COMPANY], jobsite_timecard_events: [] });

  // 4:00 PM end + 3h cutoff → nothing before 7:00 PM local (23:00Z).
  const early = await runScheduledAttendanceClockOut({ db, now: "2026-07-21T21:00:00.000Z" });
  assert.equal(early.clockedOut, 0);
  assert.equal(card.clock_out_at, null);

  const summary = await runScheduledAttendanceClockOut({ db, now: "2026-07-21T23:30:00.000Z" });
  assert.equal(summary.fallbackClockedOut, 1);
  assert.equal(card.clock_out_at, SHIFT_END);
  assert.equal(card.clock_out_method, "fallback_end_of_day");
  // A guessed boundary is never presented as a verified departure.
  assert.equal(card.status, "needs_review");
  assert.equal(card.detected_departure_at, null);
  assert.deepEqual(eventTypes(db), ["fallback_clock_out", "monitoring_stopped"]);
});

test("a card without a stored scheduled end falls back to the company work hours", async () => {
  const card = openCard({ pending_departure_at: null, detected_departure_at: null, scheduled_end: null });
  const db = makeDb({ jobsite_timecards: [card], companies: [COMPANY], jobsite_timecard_events: [] });

  await runScheduledAttendanceClockOut({ db, now: "2026-07-21T23:30:00.000Z" });

  assert.equal(card.clock_out_at, SHIFT_END);
});

test("disabling automatic attendance leaves open shifts untouched", async () => {
  const card = openCard();
  const db = makeDb({
    jobsite_timecards: [card],
    companies: [{ ...COMPANY, attendance_automatic_enabled: false }],
    jobsite_timecard_events: [],
  });

  const summary = await runScheduledAttendanceClockOut({ db, now: "2026-07-21T18:11:00.000Z" });

  assert.equal(summary.clockedOut, 0);
  assert.equal(card.clock_out_at, null);
  assert.deepEqual(eventTypes(db), []);
});

test("the sweep can be scoped to a single company", async () => {
  const mine = openCard();
  const theirs = openCard({ id: "tc-2", company_id: "co-2" });
  const db = makeDb({
    jobsite_timecards: [mine, theirs],
    companies: [COMPANY, { ...COMPANY, id: "co-2" }],
    jobsite_timecard_events: [],
  });

  const summary = await runScheduledAttendanceClockOut({
    db,
    now: "2026-07-21T18:11:00.000Z",
    companyId: "co-1",
  });

  assert.equal(summary.candidates, 1);
  assert.equal(mine.clock_out_at, EXITED_1400);
  assert.equal(theirs.clock_out_at, null);
});

test("a break is excluded from the total on an automatic clock-out", async () => {
  const card = openCard({
    break_start_at: "2026-07-21T15:00:00.000Z",
    break_end_at: "2026-07-21T15:30:00.000Z",
  });
  const db = makeDb({ jobsite_timecards: [card], companies: [COMPANY], jobsite_timecard_events: [] });

  await runScheduledAttendanceClockOut({ db, now: "2026-07-21T18:11:00.000Z" });

  assert.equal(card.total_minutes, 390); // 7 hours minus a 30-minute break
});
