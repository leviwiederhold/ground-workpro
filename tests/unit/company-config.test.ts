/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveCompanyWorkSchedule,
  getMissingCompanyConfigFields,
  isCompanyConfigComplete,
  canEditCompanyConfig,
  parseWorkDays,
  parseWorkTime,
  parseTimezone,
  timezoneField,
  workDaysField,
  workTimeField,
} from "../../src/lib/company/companyConfig.ts";
import { evaluateJobsiteEvent } from "../../src/lib/jobsite-time/domain.ts";

// A company row exactly as it is stored in / read back from Postgres. Setup
// (onboarding/complete) and Settings (company/settings) both write these same
// snake_case columns, and Attendance (resolveCompanyWorkSchedule) reads them —
// there is no setup-only shadow state.
function storedRowFromSetup(overrides: Record<string, unknown> = {}) {
  return {
    timezone: "America/Chicago",
    default_work_days: ["mon", "tue", "wed"],
    default_work_start_time: "08:00",
    default_work_end_time: "17:00",
    attendance_early_arrival_window_minutes: 90,
    attendance_late_grace_minutes: 5,
    jobsite_geofence_radius_feet: 2640,
    ...overrides,
  };
}

// 1. A new CEO completes setup and the values persist (round-trip through the
//    single canonical loader that Attendance uses).
test("new CEO completes setup and values persist", () => {
  const row = storedRowFromSetup();
  const resolved = resolveCompanyWorkSchedule(row);
  assert.ok(resolved, "schedule should resolve once required fields are set");
  assert.equal(resolved!.timezone, "America/Chicago");
  assert.deepEqual(resolved!.workDays, ["mon", "tue", "wed"]);
  assert.equal(resolved!.workStartTime, "08:00");
  assert.equal(resolved!.workEndTime, "17:00");
  assert.equal(resolved!.earlyArrivalWindowMinutes, 90);
  assert.equal(resolved!.lateGraceMinutes, 5);
});

// 2. Settings loads the SAME values setup saved (the strict parsers the Settings
//    API uses surface exactly the stored values, including Postgres `time`
//    columns that come back with seconds).
test("Settings loads the same values setup saved", () => {
  const row = storedRowFromSetup({ default_work_start_time: "08:00:00" });
  assert.deepEqual(parseWorkDays(row.default_work_days), ["mon", "tue", "wed"]);
  assert.equal(parseWorkTime(row.default_work_start_time), "08:00");
  assert.equal(parseWorkTime(row.default_work_end_time), "17:00");
  assert.equal(parseTimezone(row.timezone), "America/Chicago");
});

// 3. The CEO edits values in Settings and Attendance reflects the change (the
//    Attendance loader is pure over the company row — new row, new schedule).
test("CEO edits values in Settings and Attendance updates", () => {
  const before = resolveCompanyWorkSchedule(storedRowFromSetup());
  const editedRow = storedRowFromSetup({
    default_work_start_time: "06:30",
    default_work_days: ["mon", "tue", "wed", "thu", "fri"],
  });
  const after = resolveCompanyWorkSchedule(editedRow);
  assert.equal(before!.workStartTime, "08:00");
  assert.equal(after!.workStartTime, "06:30");
  assert.equal(after!.workDays.length, 5);
});

// 4. A direct Attendance load uses the SAVED setup values, never an invented
//    default (the saved start time is deliberately not the 07:00 fallback).
test("direct Attendance load uses saved setup values, not defaults", () => {
  const resolved = resolveCompanyWorkSchedule(storedRowFromSetup());
  assert.ok(resolved);
  assert.notEqual(resolved!.workStartTime, "07:00");
  assert.equal(resolved!.workStartTime, "08:00");
});

// 5. A legacy company missing required config resolves to null (no invented
//    defaults) and yields a targeted list of missing fields for the CEO prompt.
test("legacy company with missing values gets a targeted completion prompt", () => {
  const legacy = {
    timezone: null,
    default_work_days: null,
    default_work_start_time: null,
    default_work_end_time: null,
  };
  assert.equal(resolveCompanyWorkSchedule(legacy), null);
  const missingKeys = getMissingCompanyConfigFields(legacy).map((f) => f.key);
  assert.deepEqual(missingKeys, [
    "timezone",
    "default_work_days",
    "default_work_start_time",
    "default_work_end_time",
  ]);

  // Partially-configured legacy company → prompt targets ONLY what is missing.
  const partial = {
    timezone: "America/New_York",
    default_work_days: ["mon", "tue"],
    default_work_start_time: "07:00",
    default_work_end_time: null,
  };
  assert.equal(resolveCompanyWorkSchedule(partial), null);
  assert.deepEqual(
    getMissingCompanyConfigFields(partial).map((f) => f.key),
    ["default_work_end_time"]
  );
  assert.equal(isCompanyConfigComplete(partial), false);
  assert.equal(isCompanyConfigComplete(storedRowFromSetup()), true);
});

// 6. Only the CEO/owner (admin) may edit company configuration. The settings API
//    additionally enforces requireRole(["admin"]) server-side on GET and PATCH.
test("employee cannot edit company configuration", () => {
  assert.equal(canEditCompanyConfig("admin"), true);
  assert.equal(canEditCompanyConfig("ADMIN"), true);
  for (const role of ["operator", "foreman", "mechanic", "pm", "employee", "", null, undefined]) {
    assert.equal(canEditCompanyConfig(role as any), false, `role ${String(role)} must not edit`);
  }
});

// 7. Timezone and work-hour validation are identical in Setup and Settings —
//    both routes import these exact canonical validators, so one table proves
//    both flows accept/reject the same inputs.
test("timezone and work-hour validation are identical in Setup and Settings", () => {
  // Timezone
  assert.equal(timezoneField.safeParse("America/New_York").success, true);
  assert.equal(timezoneField.safeParse("Europe/London").success, true);
  assert.equal(timezoneField.safeParse("Not/AZone").success, false);
  assert.equal(timezoneField.safeParse("").success, false);

  // Work time (HH:MM, optional single-digit hour)
  for (const ok of ["08:00", "8:00", "23:59", "00:00"]) {
    assert.equal(workTimeField.safeParse(ok).success, true, `${ok} should be valid`);
  }
  for (const bad of ["24:00", "12:60", "abc", "8", "8:0"]) {
    assert.equal(workTimeField.safeParse(bad).success, false, `${bad} should be invalid`);
  }

  // Work days
  assert.equal(workDaysField.safeParse(["mon", "tue"]).success, true);
  assert.equal(workDaysField.safeParse([]).success, false);
  assert.equal(workDaysField.safeParse(["notaday"]).success, false);
});

// 8. Attendance status (early/on_time/late) is NOT computed until valid company
//    work hours exist — the loader gates it by only passing tuning when a
//    schedule resolved.
test("late/early status is not computed without configured work hours", () => {
  const base = {
    transition: "enter" as const,
    occurredAt: "2026-07-13T13:30:00.000Z",
    jobLat: 40, jobLng: -83, pointLat: 40, pointLng: -83,
    accuracyMeters: 10,
    radiusFeet: 5280,
    scheduledStart: "2026-07-13T13:00:00.000Z",
    scheduledEnd: "2026-07-13T22:00:00.000Z",
    hasSchedule: true,
  };

  // No company schedule → tuning omitted → arrivalStatus must stay null.
  const withoutConfig = evaluateJobsiteEvent(base);
  assert.equal(withoutConfig.arrivalStatus, null);

  // With company schedule → tuning provided → late is computed (30m past start,
  // 5m grace).
  const withConfig = evaluateJobsiteEvent({
    ...base,
    earlyArrivalWindowMinutes: 120,
    lateGraceMinutes: 5,
  });
  assert.equal(withConfig.arrivalStatus, "late");
});
