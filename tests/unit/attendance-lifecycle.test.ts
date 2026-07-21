import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTENDANCE_LIFECYCLE_STATES,
  canShowWaitingForArrival,
  collectSetupIssues,
  deriveAttendanceLifecycle,
  isBlockingIssue,
  LIFECYCLE_DESCRIPTION,
  LIFECYCLE_LABEL,
  type LifecycleInput,
} from "../../src/lib/attendance/lifecycleState.ts";

// A fully healthy, mid-window, away-from-site employee.
function healthy(over: Partial<LifecycleInput> = {}): LifecycleInput {
  return {
    automaticAttendanceEnabled: true,
    hasAssignmentToday: true,
    jobsiteHasVerifiedCoordinates: true,
    foregroundPermission: "granted",
    backgroundPermission: "granted",
    preciseLocation: true,
    nativeGeofenceSupported: true,
    assignedJobGeofenceRegistered: true,
    deviceCredentialActive: true,
    monitoringWindowActive: true,
    monitoringStartsAt: "2026-07-21T09:00:00.000Z",
    onsite: false,
    todayCard: null,
    pendingQueueCount: 0,
    lastSyncFailed: false,
    manualFallbackEnabled: true,
    ...over,
  };
}

// ── Every state has copy ─────────────────────────────────────────────────────

test("every lifecycle state has a label and a description", () => {
  for (const state of ATTENDANCE_LIFECYCLE_STATES) {
    assert.ok(LIFECYCLE_LABEL[state], `${state} has no label`);
    assert.ok(LIFECYCLE_DESCRIPTION[state], `${state} has no description`);
  }
});

test("no employee-facing copy leaks internal vocabulary", () => {
  const forbidden = /geofence|credential|idempot|confidence|ingest|reconcil|token|API|payload/i;
  for (const state of ATTENDANCE_LIFECYCLE_STATES) {
    assert.ok(!forbidden.test(LIFECYCLE_LABEL[state]), `${state} label leaks jargon`);
    assert.ok(!forbidden.test(LIFECYCLE_DESCRIPTION[state]), `${state} description leaks jargon`);
  }
});

// ── The core acceptance criterion ────────────────────────────────────────────

test("the UI never claims monitoring is active when a prerequisite is missing", () => {
  const broken: Array<[string, Partial<LifecycleInput>]> = [
    ["foreground permission", { foregroundPermission: "denied" }],
    ["background permission", { backgroundPermission: "denied" }],
    ["precise location", { preciseLocation: false }],
    ["jobsite coordinates", { jobsiteHasVerifiedCoordinates: false }],
    ["assignment", { hasAssignmentToday: false }],
    ["native registration", { assignedJobGeofenceRegistered: false }],
    ["device credential", { deviceCredentialActive: false }],
    ["native support", { nativeGeofenceSupported: false }],
    ["company switch", { automaticAttendanceEnabled: false }],
  ];
  for (const [what, patch] of broken) {
    const result = deriveAttendanceLifecycle(healthy(patch));
    assert.equal(result.monitoringActive, false, `monitoring claimed active without ${what}`);
    assert.notEqual(result.state, "monitoring_active", `headline claims monitoring with no ${what}`);
    assert.notEqual(result.state, "waiting_for_arrival", `headline claims waiting with no ${what}`);
  }
});

test("monitoring is active only when everything genuinely checks out", () => {
  const result = deriveAttendanceLifecycle(healthy({ onsite: null }));
  assert.equal(result.monitoringActive, true);
  assert.equal(result.state, "monitoring_active");
  assert.deepEqual(result.issues, []);
});

// ── "Waiting for arrival" is gated on all three conditions ───────────────────

test("waiting for arrival requires monitoring, health, AND proof of being away", () => {
  assert.equal(canShowWaitingForArrival({ monitoringActive: true, geofenceHealthy: true, onsite: false }), true);
  assert.equal(canShowWaitingForArrival({ monitoringActive: false, geofenceHealthy: true, onsite: false }), false);
  assert.equal(canShowWaitingForArrival({ monitoringActive: true, geofenceHealthy: false, onsite: false }), false);
  // The important one: an unknown location is NOT "away".
  assert.equal(canShowWaitingForArrival({ monitoringActive: true, geofenceHealthy: true, onsite: null }), false);
  assert.equal(canShowWaitingForArrival({ monitoringActive: true, geofenceHealthy: true, onsite: true }), false);
});

test("an unknown location shows monitoring active, never waiting for arrival", () => {
  assert.equal(deriveAttendanceLifecycle(healthy({ onsite: null })).state, "monitoring_active");
  assert.equal(deriveAttendanceLifecycle(healthy({ onsite: false })).state, "waiting_for_arrival");
});

test("being inside the geofence never resolves to waiting for arrival", () => {
  const result = deriveAttendanceLifecycle(healthy({ onsite: true }));
  assert.notEqual(result.state, "waiting_for_arrival");
  assert.equal(result.state, "monitoring_active");
});

// ── The record outranks predictions ──────────────────────────────────────────

test("today's record is reported even when the setup has since degraded", () => {
  const clockedIn = deriveAttendanceLifecycle(
    healthy({
      todayCard: { clockInAt: "2026-07-21T11:00:00.000Z", clockOutAt: null, pendingDepartureAt: null, onsiteBeforeShiftAt: null },
      // Permission was revoked after the clock-in — the shift still happened.
      foregroundPermission: "denied",
    })
  );
  assert.equal(clockedIn.state, "clocked_in_automatically");
  // …but the problem is not hidden, and monitoring is not claimed.
  assert.ok(clockedIn.issues.includes("permission_setup_required"));
  assert.equal(clockedIn.monitoringActive, false);
});

test("the record states are reported in lifecycle order", () => {
  const at = "2026-07-21T11:00:00.000Z";
  const onsiteEarly = deriveAttendanceLifecycle(
    healthy({ todayCard: { clockInAt: null, clockOutAt: null, pendingDepartureAt: null, onsiteBeforeShiftAt: "2026-07-21T10:50:00.000Z" } })
  );
  assert.equal(onsiteEarly.state, "onsite_before_shift");

  const clockedIn = deriveAttendanceLifecycle(
    healthy({ todayCard: { clockInAt: at, clockOutAt: null, pendingDepartureAt: null, onsiteBeforeShiftAt: null } })
  );
  assert.equal(clockedIn.state, "clocked_in_automatically");

  const leaving = deriveAttendanceLifecycle(
    healthy({ todayCard: { clockInAt: at, clockOutAt: null, pendingDepartureAt: "2026-07-21T18:00:00.000Z", onsiteBeforeShiftAt: null } })
  );
  assert.equal(leaving.state, "departure_pending");

  const done = deriveAttendanceLifecycle(
    healthy({ todayCard: { clockInAt: at, clockOutAt: "2026-07-21T20:00:00.000Z", pendingDepartureAt: null, onsiteBeforeShiftAt: null } })
  );
  assert.equal(done.state, "clocked_out_automatically");
});

// ── Individual setup problems name themselves ────────────────────────────────

test("a single setup problem is reported specifically, not as a vague failure", () => {
  const cases: Array<[Partial<LifecycleInput>, string]> = [
    [{ hasAssignmentToday: false }, "no_assignment_today"],
    [{ jobsiteHasVerifiedCoordinates: false }, "jobsite_missing_coordinates"],
    [{ foregroundPermission: "denied" }, "permission_setup_required"],
    [{ backgroundPermission: "denied" }, "background_permission_missing"],
    [{ preciseLocation: false }, "precise_location_unavailable"],
    [{ assignedJobGeofenceRegistered: false }, "native_geofence_unavailable"],
    [{ deviceCredentialActive: false }, "native_geofence_unavailable"],
    [{ automaticAttendanceEnabled: false }, "automatic_attendance_disabled"],
  ];
  for (const [patch, expected] of cases) {
    assert.equal(deriveAttendanceLifecycle(healthy(patch)).state, expected, JSON.stringify(patch));
  }
});

test("several problems at once are reported as degraded, with the full list", () => {
  const result = deriveAttendanceLifecycle(
    healthy({ foregroundPermission: "denied", jobsiteHasVerifiedCoordinates: false })
  );
  assert.equal(result.state, "automatic_attendance_degraded");
  assert.ok(result.issues.includes("permission_setup_required"));
  assert.ok(result.issues.includes("jobsite_missing_coordinates"));
});

test("a missing assignment does not also report every consequence of itself", () => {
  const issues = collectSetupIssues(healthy({ hasAssignmentToday: false, jobsiteHasVerifiedCoordinates: false }));
  assert.ok(issues.includes("no_assignment_today"));
  assert.ok(!issues.includes("jobsite_missing_coordinates"));
});

test("an unknown background permission is not reported as a problem", () => {
  // Reporting "unknown" as broken would nag every employee on a platform that
  // simply does not expose the answer.
  const issues = collectSetupIssues(healthy({ backgroundPermission: "unknown" }));
  assert.ok(!issues.includes("background_permission_missing"));
});

test("background permission is irrelevant where background monitoring does not exist", () => {
  const issues = collectSetupIssues(
    healthy({ nativeGeofenceSupported: false, backgroundPermission: "denied" })
  );
  assert.ok(!issues.includes("background_permission_missing"));
  assert.ok(issues.includes("native_geofence_unavailable"));
});

// ── Sync states ──────────────────────────────────────────────────────────────

test("a queue backlog is surfaced, but only when nothing more important is wrong", () => {
  const backlog = deriveAttendanceLifecycle(healthy({ pendingQueueCount: 3, onsite: null }));
  assert.equal(backlog.state, "offline_events_pending");

  const alsoBroken = deriveAttendanceLifecycle(healthy({ pendingQueueCount: 3, foregroundPermission: "denied" }));
  assert.equal(alsoBroken.state, "permission_setup_required");
  assert.ok(alsoBroken.issues.includes("offline_events_pending"));
});

test("a failed sync outranks a mere backlog", () => {
  const result = deriveAttendanceLifecycle(healthy({ pendingQueueCount: 2, lastSyncFailed: true, onsite: null }));
  assert.equal(result.state, "last_sync_failed");
});

test("a sync problem does not block monitoring — the pipeline still works", () => {
  const result = deriveAttendanceLifecycle(healthy({ pendingQueueCount: 2 }));
  assert.equal(result.monitoringActive, true);
  assert.ok(!isBlockingIssue("offline_events_pending"));
  assert.ok(!isBlockingIssue("last_sync_failed"));
});

// ── Monitoring window ────────────────────────────────────────────────────────

test("before the window opens, the employee is told when it will", () => {
  const result = deriveAttendanceLifecycle(healthy({ monitoringWindowActive: false }));
  assert.equal(result.state, "monitoring_starts_at");
  assert.equal(result.monitoringStartsAt, "2026-07-21T09:00:00.000Z");
  assert.equal(result.monitoringActive, false);
});

test("an unknown window is never reported as an active one", () => {
  const result = deriveAttendanceLifecycle(healthy({ monitoringWindowActive: null, onsite: false }));
  assert.equal(result.monitoringActive, false);
  assert.notEqual(result.state, "waiting_for_arrival");
});

// ── Manual fallback ──────────────────────────────────────────────────────────

test("manual fallback is offered when allowed, and promoted when automatic is broken", () => {
  const working = deriveAttendanceLifecycle(healthy());
  assert.equal(working.manualFallbackAvailable, true);
  assert.equal(working.manualFallbackRecommended, false);

  const broken = deriveAttendanceLifecycle(healthy({ foregroundPermission: "denied" }));
  assert.equal(broken.manualFallbackRecommended, true);

  const off = deriveAttendanceLifecycle(healthy({ automaticAttendanceEnabled: false }));
  assert.equal(off.manualFallbackRecommended, true);
});

test("manual fallback disappears when the company turns it off", () => {
  const result = deriveAttendanceLifecycle(healthy({ manualFallbackEnabled: false }));
  assert.equal(result.manualFallbackAvailable, false);
});
