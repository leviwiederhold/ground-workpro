import test from "node:test";
import assert from "node:assert/strict";
import {
  computeOnsite,
  reconcileAttendanceState,
  type ReconcileInput,
} from "../../src/lib/jobsite-time/reconcileAttendance.ts";

const NOW = "2026-07-20T15:00:00.000Z"; // after a 14:00 shift start

function baseInput(over: Partial<ReconcileInput> = {}): ReconcileInput {
  return {
    assignedJob: { jobId: "job-1", lat: 40.0, lng: -75.0, addressVerified: true },
    arrivalRadiusFeet: 250,
    location: { lat: 40.0, lng: -75.0, accuracyMeters: 10, capturedAt: NOW },
    schedule: { startAt: "2026-07-20T14:00:00.000Z", endAt: "2026-07-20T22:00:00.000Z" },
    monitoringLeadMinutes: 120,
    todayCard: null,
    now: NOW,
    ...over,
  };
}

test("computeOnsite: distance is ~0 at the jobsite and inside the radius", () => {
  const r = computeOnsite(
    { jobId: "j", lat: 40, lng: -75, addressVerified: true },
    { lat: 40, lng: -75, accuracyMeters: 5, capturedAt: NOW },
    250
  );
  assert.equal(r.distanceMeters, 0);
  assert.equal(r.onsite, true);
});

test("computeOnsite: a point ~1.5km away is outside a 250ft radius", () => {
  const r = computeOnsite(
    { jobId: "j", lat: 40, lng: -75, addressVerified: true },
    { lat: 40, lng: -75.0175, accuracyMeters: 5, capturedAt: NOW },
    250
  );
  assert.ok(r.distanceMeters && r.distanceMeters > 1000);
  assert.equal(r.onsite, false);
});

test("computeOnsite: known distance is accurate (0.001° latitude ≈ 111 m)", () => {
  const r = computeOnsite(
    { jobId: "j", lat: 40, lng: -75, addressVerified: true },
    { lat: 40.001, lng: -75, accuracyMeters: 5, capturedAt: NOW },
    250
  );
  // 0.001 degrees latitude ≈ 111.19 m.
  assert.ok(r.distanceMeters !== null && Math.abs(r.distanceMeters - 111) < 2, `got ${r.distanceMeters}`);
  // 250 ft ≈ 76 m, so 111 m is outside.
  assert.equal(r.onsite, false);
});

test("computeOnsite returns null onsite when coordinates or fix are missing", () => {
  assert.deepEqual(
    computeOnsite({ jobId: "j", lat: null, lng: null, addressVerified: true }, { lat: 40, lng: -75, accuracyMeters: 5, capturedAt: NOW }, 250),
    { distanceMeters: null, onsite: null }
  );
  assert.deepEqual(
    computeOnsite({ jobId: "j", lat: 40, lng: -75, addressVerified: true }, null, 250),
    { distanceMeters: null, onsite: null }
  );
});

test("onsite after shift start with no record requests a clock-in repair (never waiting_for_arrival)", () => {
  const r = reconcileAttendanceState(baseInput());
  assert.equal(r.status, "clocked_in");
  assert.equal(r.onsite, true);
  assert.equal(r.shouldCreateClockIn, true);
});

test("onsite before shift start shows onsite_before_shift and does NOT clock in", () => {
  // now 12:30, shift 14:00, lead 120m → window opened 12:00, so in-window but pre-shift.
  const r = reconcileAttendanceState(baseInput({ now: "2026-07-20T12:30:00.000Z" }));
  assert.equal(r.status, "onsite_before_shift");
  assert.equal(r.shouldCreateClockIn, false);
});

test("onsite before the monitoring window opens shows waiting_for_monitoring_window", () => {
  // now 11:00, window opens 12:00.
  const r = reconcileAttendanceState(baseInput({ now: "2026-07-20T11:00:00.000Z" }));
  assert.equal(r.status, "waiting_for_monitoring_window");
  assert.equal(r.shouldCreateClockIn, false);
});

test("with unknown schedule, being onsite reconciles immediately (server arbitrates window)", () => {
  const r = reconcileAttendanceState(baseInput({ schedule: null, monitoringLeadMinutes: null }));
  assert.equal(r.status, "clocked_in");
  assert.equal(r.shouldCreateClockIn, true);
});

test("missing coordinates surface a real error, not waiting_for_arrival", () => {
  const r = reconcileAttendanceState(
    baseInput({ assignedJob: { jobId: "j", lat: null, lng: null, addressVerified: false } })
  );
  assert.equal(r.status, "automatic_attendance_inactive");
  assert.equal(r.errorReason, "JOB_MISSING_COORDINATES");
});

test("no assignment is inactive", () => {
  assert.equal(reconcileAttendanceState(baseInput({ assignedJob: null })).status, "automatic_attendance_inactive");
});

test("an existing open clock-in reports clocked_in; a good fix far away reports departure_pending", () => {
  const open = { clockInAt: "2026-07-20T14:05:00.000Z", clockOutAt: null, status: "active" };
  assert.equal(reconcileAttendanceState(baseInput({ todayCard: open })).status, "clocked_in");
  const far = reconcileAttendanceState(
    baseInput({ todayCard: open, location: { lat: 40, lng: -75.0175, accuracyMeters: 5, capturedAt: NOW } })
  );
  assert.equal(far.status, "departure_pending");
  assert.equal(far.shouldCreateClockIn, false);
});

test("a completed card reports clocked_out", () => {
  const done = { clockInAt: "2026-07-20T14:05:00.000Z", clockOutAt: "2026-07-20T22:05:00.000Z", status: "approved" };
  assert.equal(reconcileAttendanceState(baseInput({ todayCard: done })).status, "clocked_out");
});

test("an unusable (inaccurate) fix does not force a clock-in", () => {
  const r = reconcileAttendanceState(
    baseInput({ location: { lat: 40, lng: -75, accuracyMeters: 5000, capturedAt: NOW } })
  );
  // Distance is ~0 so onsite is true, but the fix is not trustworthy → no repair.
  assert.equal(r.shouldCreateClockIn, false);
});
