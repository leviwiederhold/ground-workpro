import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_AUTOMATIC_ATTENDANCE_SETTINGS,
  buildAttendanceSettingsUpdate,
  mapRowToAttendanceSettings,
  validateAttendanceSettingsPatch,
} from "../../src/lib/attendance/attendanceSettings.ts";

test("defaults match the documented values", () => {
  assert.deepEqual(DEFAULT_AUTOMATIC_ATTENDANCE_SETTINGS, {
    automaticAttendanceEnabled: true,
    monitoringLeadMinutes: 120,
    geofenceRadiusMeters: 200,
    arrivalDwellMinutes: 2,
    earlyArrivalMode: "scheduled_start",
    departureGraceMinutes: 10,
    endOfDayCutoffMinutes: 180,
    manualFallbackEnabled: true,
    timezone: DEFAULT_AUTOMATIC_ATTENDANCE_SETTINGS.timezone,
  });
});

test("mapRowToAttendanceSettings fills defaults for an empty/absent row", () => {
  assert.deepEqual(mapRowToAttendanceSettings(null), DEFAULT_AUTOMATIC_ATTENDANCE_SETTINGS);
  assert.deepEqual(mapRowToAttendanceSettings({}), DEFAULT_AUTOMATIC_ATTENDANCE_SETTINGS);
});

test("mapRowToAttendanceSettings reads stored columns", () => {
  const s = mapRowToAttendanceSettings({
    attendance_automatic_enabled: false,
    attendance_early_arrival_window_minutes: 90,
    attendance_geofence_radius_meters: 150,
    attendance_arrival_dwell_minutes: 5,
    attendance_early_arrival_mode: "clock_in_on_arrival",
    attendance_departure_grace_minutes: 15,
    attendance_end_of_day_cutoff_minutes: 240,
    jobsite_manual_fallback_enabled: false,
    timezone: "America/Los_Angeles",
  });
  assert.equal(s.automaticAttendanceEnabled, false);
  assert.equal(s.monitoringLeadMinutes, 90);
  assert.equal(s.geofenceRadiusMeters, 150);
  assert.equal(s.arrivalDwellMinutes, 5);
  assert.equal(s.earlyArrivalMode, "clock_in_on_arrival");
  assert.equal(s.departureGraceMinutes, 15);
  assert.equal(s.endOfDayCutoffMinutes, 240);
  assert.equal(s.manualFallbackEnabled, false);
  assert.equal(s.timezone, "America/Los_Angeles");
});

test("an unknown early-arrival mode falls back to the default", () => {
  const s = mapRowToAttendanceSettings({ attendance_early_arrival_mode: "nonsense" });
  assert.equal(s.earlyArrivalMode, "scheduled_start");
});

test("validation accepts a valid partial patch", () => {
  const r = validateAttendanceSettingsPatch({ geofenceRadiusMeters: 300, earlyArrivalMode: "clock_in_on_arrival" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.value, { geofenceRadiusMeters: 300, earlyArrivalMode: "clock_in_on_arrival" });
});

test("validation rejects out-of-range, non-integer, wrong-type, bad enum and bad timezone", () => {
  const bad = validateAttendanceSettingsPatch({
    geofenceRadiusMeters: 10, // below min 50
    monitoringLeadMinutes: 10.5, // non-integer
    automaticAttendanceEnabled: "yes", // wrong type
    earlyArrivalMode: "whenever", // bad enum
    timezone: "Mars/Phobos", // bad tz
  });
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    for (const key of ["geofenceRadiusMeters", "monitoringLeadMinutes", "automaticAttendanceEnabled", "earlyArrivalMode", "timezone"]) {
      assert.ok(bad.errors[key], `expected error for ${key}`);
    }
  }
});

test("validation accepts boundary values", () => {
  const r = validateAttendanceSettingsPatch({ geofenceRadiusMeters: 50, endOfDayCutoffMinutes: 1440, arrivalDwellMinutes: 0 });
  assert.equal(r.ok, true);
});

test("buildAttendanceSettingsUpdate maps fields to company columns", () => {
  const update = buildAttendanceSettingsUpdate({
    geofenceRadiusMeters: 250,
    monitoringLeadMinutes: 90,
    manualFallbackEnabled: false,
    timezone: "America/Chicago",
  });
  assert.deepEqual(update, {
    attendance_geofence_radius_meters: 250,
    attendance_early_arrival_window_minutes: 90,
    jobsite_manual_fallback_enabled: false,
    timezone: "America/Chicago",
  });
});
