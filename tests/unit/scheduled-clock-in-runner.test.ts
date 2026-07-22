import test from "node:test";
import assert from "node:assert/strict";
import { runScheduledAttendanceClockIn } from "../../src/lib/attendance/scheduledClockInRunner.ts";
import { makeDb, eventTypes, type Row } from "./helpers/fakeSupabase.ts";

// America/New_York in July is UTC-4: 07:00 local = 11:00Z.
const SHIFT_START = "2026-07-21T11:00:00.000Z";
const ARRIVED_0650 = "2026-07-21T10:50:00.000Z";

const COMPANY = {
  id: "co-1",
  timezone: "America/New_York",
  default_work_days: "mon,tue,wed,thu,fri",
  default_work_start_time: "07:00",
  default_work_end_time: "16:00",
  attendance_automatic_enabled: true,
  attendance_arrival_dwell_minutes: 2,
  attendance_early_arrival_mode: "scheduled_start",
  jobsite_arrival_confirmation_seconds: 45,
};

function arrivedCard(over: Row = {}): Row {
  return {
    id: "tc-1",
    company_id: "co-1",
    job_id: "job-1",
    employee_id: "emp-1",
    user_id: "user-1",
    work_date: "2026-07-21",
    scheduled_start: SHIFT_START,
    clock_in_at: null,
    clock_out_at: null,
    pending_arrival_at: ARRIVED_0650,
    pending_departure_at: null,
    onsite_before_shift_at: null,
    detected_arrival_at: null,
    ...over,
  };
}

test("before the shift: records onsite-before-shift and creates no clock-in", async () => {
  const card = arrivedCard();
  const db = makeDb({ jobsite_timecards: [card], companies: [COMPANY], jobsite_timecard_events: [] });

  const summary = await runScheduledAttendanceClockIn({ db, now: "2026-07-21T10:53:00.000Z" });

  assert.equal(summary.candidates, 1);
  assert.equal(summary.clockedIn, 0);
  assert.equal(summary.onsiteBeforeShift, 1);
  assert.equal(card.clock_in_at, null);
  assert.equal(card.onsite_before_shift_at, ARRIVED_0650);
  assert.deepEqual(eventTypes(db), ["onsite_before_shift"]);
});

test("the onsite-before-shift event is logged once, not on every pass", async () => {
  const card = arrivedCard();
  const db = makeDb({ jobsite_timecards: [card], companies: [COMPANY], jobsite_timecard_events: [] });

  await runScheduledAttendanceClockIn({ db, now: "2026-07-21T10:53:00.000Z" });
  await runScheduledAttendanceClockIn({ db, now: "2026-07-21T10:54:00.000Z" });
  const summary = await runScheduledAttendanceClockIn({ db, now: "2026-07-21T10:55:00.000Z" });

  assert.deepEqual(eventTypes(db), ["onsite_before_shift"]);
  assert.equal(summary.onsiteBeforeShift, 0);
  assert.equal(summary.waiting, 1);
});

test("at the scheduled start: clocks in at 7:00 with the app never opened", async () => {
  const card = arrivedCard({ onsite_before_shift_at: ARRIVED_0650 });
  const db = makeDb({ jobsite_timecards: [card], companies: [COMPANY], jobsite_timecard_events: [] });

  const summary = await runScheduledAttendanceClockIn({ db, now: SHIFT_START });

  assert.equal(summary.clockedIn, 1);
  assert.equal(summary.backfilled, 0);
  assert.equal(card.clock_in_at, SHIFT_START);
  assert.equal(card.clock_in_method, "scheduled_start");
  assert.equal(card.pending_arrival_at, null);
  // The arrival timestamp is preserved even though the clock-in is at 7:00.
  assert.equal(card.detected_arrival_at, ARRIVED_0650);
  assert.deepEqual(eventTypes(db), ["scheduled_clock_in"]);
});

test("a second pass after the clock-in creates no duplicate record or event", async () => {
  const card = arrivedCard();
  const db = makeDb({ jobsite_timecards: [card], companies: [COMPANY], jobsite_timecard_events: [] });

  await runScheduledAttendanceClockIn({ db, now: SHIFT_START });
  const again = await runScheduledAttendanceClockIn({ db, now: "2026-07-21T11:05:00.000Z" });

  // The row no longer has a pending arrival, so it is not even a candidate.
  assert.equal(again.candidates, 0);
  assert.equal(db.tables.jobsite_timecards.length, 1);
  assert.deepEqual(eventTypes(db), ["scheduled_clock_in"]);
});

test("a delayed run backfills to 7:00 and says so in the audit trail", async () => {
  const card = arrivedCard();
  const db = makeDb({ jobsite_timecards: [card], companies: [COMPANY], jobsite_timecard_events: [] });

  const summary = await runScheduledAttendanceClockIn({ db, now: "2026-07-21T13:30:00.000Z" });

  assert.equal(summary.clockedIn, 1);
  assert.equal(summary.backfilled, 1);
  assert.equal(card.clock_in_at, SHIFT_START);
  assert.equal(card.clock_in_method, "scheduled_start_backfilled");
  assert.deepEqual(eventTypes(db), ["scheduled_clock_in", "clock_in_backfilled"]);
});

test("an employee who left before the shift is never clocked in", async () => {
  const card = arrivedCard();
  const db = makeDb({
    jobsite_timecards: [card],
    companies: [COMPANY],
    // A late-flushed exit at 6:55, before the 7:00 start.
    jobsite_timecard_events: [
      { id: "e1", timecard_id: "tc-1", event_type: "exited_geofence", occurred_at: "2026-07-21T10:55:00.000Z" },
    ],
  });

  const summary = await runScheduledAttendanceClockIn({ db, now: SHIFT_START });

  assert.equal(summary.rejected, 1);
  assert.equal(summary.clockedIn, 0);
  assert.equal(card.clock_in_at, null);
  assert.equal(card.pending_arrival_at, null);
  assert.ok(eventTypes(db).includes("clock_in_rejected"));
});

test("a clock-in open at another job blocks a second concurrent clock-in", async () => {
  const card = arrivedCard();
  const otherJob = {
    id: "tc-other",
    company_id: "co-1",
    job_id: "job-2",
    user_id: "user-1",
    work_date: "2026-07-21",
    clock_in_at: "2026-07-21T09:00:00.000Z",
    clock_out_at: null,
    pending_arrival_at: null,
    pending_departure_at: null,
  };
  const db = makeDb({
    jobsite_timecards: [card, otherJob],
    companies: [COMPANY],
    jobsite_timecard_events: [],
  });

  const summary = await runScheduledAttendanceClockIn({ db, now: SHIFT_START });

  assert.equal(summary.rejected, 1);
  assert.equal(summary.clockedIn, 0);
  assert.equal(card.clock_in_at, null);
  // The arrival is kept: the conflict may clear when the other job's departure
  // finalizes, and this arrival is still valid.
  assert.equal(card.pending_arrival_at, ARRIVED_0650);
});

test("clock_in_on_arrival clocks in at the arrival instead of the shift start", async () => {
  const card = arrivedCard();
  const db = makeDb({
    jobsite_timecards: [card],
    companies: [{ ...COMPANY, attendance_early_arrival_mode: "clock_in_on_arrival" }],
    jobsite_timecard_events: [],
  });

  await runScheduledAttendanceClockIn({ db, now: "2026-07-21T10:53:00.000Z" });

  assert.equal(card.clock_in_at, ARRIVED_0650);
  assert.equal(card.clock_in_method, "arrival");
  assert.deepEqual(eventTypes(db), ["auto_clock_in"]);
});

test("disabling automatic attendance stops the pipeline without touching records", async () => {
  const card = arrivedCard();
  const db = makeDb({
    jobsite_timecards: [card],
    companies: [{ ...COMPANY, attendance_automatic_enabled: false }],
    jobsite_timecard_events: [],
  });

  const summary = await runScheduledAttendanceClockIn({ db, now: SHIFT_START });

  assert.equal(summary.candidates, 1);
  assert.equal(summary.clockedIn, 0);
  assert.equal(card.clock_in_at, null);
  assert.deepEqual(eventTypes(db), []);
});

test("a timecard with no stored scheduled start uses the company work hours", async () => {
  const card = arrivedCard({ scheduled_start: null });
  const db = makeDb({ jobsite_timecards: [card], companies: [COMPANY], jobsite_timecard_events: [] });

  // 10:59Z is 6:59 local — still before the derived 07:00 start.
  await runScheduledAttendanceClockIn({ db, now: "2026-07-21T10:59:00.000Z" });
  assert.equal(card.clock_in_at, null);

  await runScheduledAttendanceClockIn({ db, now: SHIFT_START });
  assert.equal(card.clock_in_at, SHIFT_START);
});

test("the sweep can be scoped to a single company", async () => {
  const mine = arrivedCard();
  const theirs = arrivedCard({ id: "tc-2", company_id: "co-2" });
  const db = makeDb({
    jobsite_timecards: [mine, theirs],
    companies: [COMPANY, { ...COMPANY, id: "co-2" }],
    jobsite_timecard_events: [],
  });

  const summary = await runScheduledAttendanceClockIn({ db, now: SHIFT_START, companyId: "co-1" });

  assert.equal(summary.candidates, 1);
  assert.equal(mine.clock_in_at, SHIFT_START);
  assert.equal(theirs.clock_in_at, null);
});
