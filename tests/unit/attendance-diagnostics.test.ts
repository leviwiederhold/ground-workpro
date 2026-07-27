import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAttendanceDiagnostics,
  classifyLocation,
  computeMonitoringWindow,
  evaluateAutoAttendanceInactiveReason,
  DEFAULT_MAX_LOCATION_ACCURACY_METERS,
  DEFAULT_MAX_LOCATION_AGE_MS,
  type AttendanceDiagnosticsInput,
} from "../../src/lib/jobsite-time/attendanceDiagnostics.ts";

const NOW = "2026-07-20T13:00:00.000Z";

// A fully-healthy input (automatic attendance active), that each test perturbs.
function baseInput(over: Partial<AttendanceDiagnosticsInput> = {}): AttendanceDiagnosticsInput {
  return {
    employeeId: "emp-1",
    assignedJob: { jobId: "job-1", name: "Main St", lat: 40.0, lng: -75.0, addressVerified: true },
    geofenceRadiusFeet: 250,
    wakeRadiusMeters: 1609,
    monitoringLeadMinutes: 120,
    schedule: { startAt: "2026-07-20T14:00:00.000Z", endAt: "2026-07-20T22:00:00.000Z" },
    permissions: {
      foreground: "granted",
      background: "granted",
      preciseLocation: true,
      locationServicesEnabled: true,
    },
    location: { lat: 40.0, lng: -75.0, accuracyMeters: 10, capturedAt: NOW },
    registeredGeofences: [{ jobId: "job-1", zone: "arrival", radiusMeters: 76 }],
    lastGeofenceEntryAt: null,
    lastGeofenceExitAt: null,
    lastSuccessfulSyncAt: NOW,
    attendanceStatus: "waiting",
    nativeGeofenceSupported: true,
    now: NOW,
    ...over,
  };
}

test("healthy pipeline reports automatic attendance active (no inactive reason)", () => {
  const d = buildAttendanceDiagnostics(baseInput());
  assert.equal(d.inactiveReason, null);
  assert.equal(d.automaticAttendanceActive, true);
  assert.equal(d.isWithinGeofence, true);
  assert.equal(d.distanceMeters, 0);
});

test("NO_ASSIGNMENT when no job is assigned", () => {
  assert.equal(evaluateAutoAttendanceInactiveReason(baseInput({ assignedJob: null })), "NO_ASSIGNMENT");
});

test("JOB_MISSING_COORDINATES for missing or unverified coordinates", () => {
  assert.equal(
    evaluateAutoAttendanceInactiveReason(
      baseInput({ assignedJob: { jobId: "j", name: "n", lat: null, lng: null, addressVerified: true } })
    ),
    "JOB_MISSING_COORDINATES"
  );
  assert.equal(
    evaluateAutoAttendanceInactiveReason(
      baseInput({ assignedJob: { jobId: "j", name: "n", lat: 40, lng: -75, addressVerified: false } })
    ),
    "JOB_MISSING_COORDINATES"
  );
});

test("permission causes are distinguishable from assignment and GPS", () => {
  assert.equal(
    evaluateAutoAttendanceInactiveReason(
      baseInput({ permissions: { foreground: "denied", background: "denied", preciseLocation: true, locationServicesEnabled: true } })
    ),
    "LOCATION_PERMISSION_DENIED"
  );
  assert.equal(
    evaluateAutoAttendanceInactiveReason(
      baseInput({ permissions: { foreground: "granted", background: "prompt", preciseLocation: true, locationServicesEnabled: true } })
    ),
    "BACKGROUND_PERMISSION_MISSING"
  );
  assert.equal(
    evaluateAutoAttendanceInactiveReason(
      baseInput({ permissions: { foreground: "granted", background: "granted", preciseLocation: false, locationServicesEnabled: true } })
    ),
    "PRECISE_LOCATION_DISABLED"
  );
  assert.equal(
    evaluateAutoAttendanceInactiveReason(
      baseInput({ permissions: { foreground: "granted", background: "granted", preciseLocation: true, locationServicesEnabled: false } })
    ),
    "LOCATION_UNAVAILABLE"
  );
});

test("background permission is NOT required when native geofencing is unsupported (web)", () => {
  const reason = evaluateAutoAttendanceInactiveReason(
    baseInput({
      nativeGeofenceSupported: false,
      permissions: { foreground: "granted", background: "unavailable", preciseLocation: true, locationServicesEnabled: true },
    })
  );
  assert.equal(reason, null);
});

test("OUTSIDE_MONITORING_WINDOW before the lead window opens", () => {
  // Shift starts 14:00, lead 120m → window opens 12:00. now 11:00 → outside.
  const reason = evaluateAutoAttendanceInactiveReason(
    baseInput({ now: "2026-07-20T11:00:00.000Z" })
  );
  assert.equal(reason, "OUTSIDE_MONITORING_WINDOW");
});

test("monitoring window is not asserted when schedule/lead is unknown", () => {
  const window = computeMonitoringWindow(null, 120, NOW);
  assert.equal(window.active, null);
  // With unknown schedule, the window reason must not fire.
  const reason = evaluateAutoAttendanceInactiveReason(baseInput({ schedule: null }));
  assert.notEqual(reason, "OUTSIDE_MONITORING_WINDOW");
});

test("GEOFENCE_NOT_REGISTERED when the assigned job has no native geofence", () => {
  assert.equal(
    evaluateAutoAttendanceInactiveReason(baseInput({ registeredGeofences: [] })),
    "GEOFENCE_NOT_REGISTERED"
  );
});

test("LOCATION_UNAVAILABLE for missing, stale, or inaccurate fixes", () => {
  assert.equal(evaluateAutoAttendanceInactiveReason(baseInput({ location: null })), "LOCATION_UNAVAILABLE");
  assert.equal(
    evaluateAutoAttendanceInactiveReason(
      baseInput({ location: { lat: 40, lng: -75, accuracyMeters: 10, capturedAt: "2026-07-20T12:00:00.000Z" } })
    ),
    "LOCATION_UNAVAILABLE"
  );
  assert.equal(
    evaluateAutoAttendanceInactiveReason(
      baseInput({ location: { lat: 40, lng: -75, accuracyMeters: 5000, capturedAt: NOW } })
    ),
    "LOCATION_UNAVAILABLE"
  );
});

test("OUTSIDE_GEOFENCE when a good fix is far from the jobsite", () => {
  // ~1.5km away, well outside a 250ft arrival radius.
  const reason = evaluateAutoAttendanceInactiveReason(
    baseInput({ location: { lat: 40.0, lng: -75.0175, accuracyMeters: 10, capturedAt: NOW } })
  );
  assert.equal(reason, "OUTSIDE_GEOFENCE");
});

test("classifyLocation flags missing/stale/inaccurate/usable", () => {
  assert.deepEqual(classifyLocation(null, NOW, 100, DEFAULT_MAX_LOCATION_AGE_MS), { usable: false, reason: "missing" });
  assert.deepEqual(
    classifyLocation({ lat: 1, lng: 1, accuracyMeters: 10, capturedAt: "2026-07-20T12:00:00.000Z" }, NOW, 100, DEFAULT_MAX_LOCATION_AGE_MS),
    { usable: false, reason: "stale" }
  );
  assert.deepEqual(
    classifyLocation({ lat: 1, lng: 1, accuracyMeters: 999, capturedAt: NOW }, NOW, DEFAULT_MAX_LOCATION_ACCURACY_METERS, DEFAULT_MAX_LOCATION_AGE_MS),
    { usable: false, reason: "inaccurate" }
  );
  assert.deepEqual(
    classifyLocation({ lat: 1, lng: 1, accuracyMeters: 10, capturedAt: NOW }, NOW, 100, DEFAULT_MAX_LOCATION_AGE_MS),
    { usable: true, reason: "none" }
  );
});

test("snapshot carries a single fix and no credential fields (privacy)", () => {
  const d = buildAttendanceDiagnostics(baseInput());
  const keys = Object.keys(d);
  for (const forbidden of ["token", "accessToken", "password", "session", "locationHistory", "positions"]) {
    assert.equal(keys.includes(forbidden), false, `snapshot must not expose ${forbidden}`);
  }
  // Exactly one location fix object, not an array/history.
  assert.equal(Array.isArray(d.location), false);
});
