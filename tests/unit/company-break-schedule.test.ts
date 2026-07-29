import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  deriveCompanyBreakState,
  type BreakSession,
  type CompanyBreakSchedule,
} from "../../src/lib/attendance/companyBreakSchedule.ts";
import { computeMonitoringPlan } from "../../src/lib/attendance/monitoringPlan.ts";

const schedule: CompanyBreakSchedule = {
  startTime: "12:00",
  endTime: "13:00",
  returnGraceMinutes: 15,
  timezone: "UTC",
};

const session = (clockInAt: string, clockOutAt: string | null = null): BreakSession => ({
  clockInAt,
  clockOutAt,
});

const state = (
  now: string,
  sessions: BreakSession[],
  override: Partial<CompanyBreakSchedule> = {}
) =>
  deriveCompanyBreakState({
    now,
    workDate: "2026-07-29",
    schedule: { ...schedule, ...override },
    sessions,
  });

test("no break configured produces no break state", () => {
  assert.equal(
    state(
      "2026-07-29T12:30:00.000Z",
      [session("2026-07-29T07:00:00.000Z", "2026-07-29T12:10:00.000Z")],
      { startTime: null, endTime: null }
    ).status,
    "none"
  );
});

test("employee who stays onsite through lunch has no break exception", () => {
  assert.equal(
    state("2026-07-29T12:30:00.000Z", [session("2026-07-29T07:00:00.000Z")]).status,
    "none"
  );
});

test("employee who leaves and returns during lunch clears the expected break state", () => {
  const sessions = [
    session("2026-07-29T07:00:00.000Z", "2026-07-29T12:05:00.000Z"),
    session("2026-07-29T12:40:00.000Z"),
  ];
  assert.equal(state("2026-07-29T12:10:00.000Z", sessions.slice(0, 1)).status, "expected_break");
  assert.equal(state("2026-07-29T12:45:00.000Z", sessions).status, "none");
});

test("departure before lunch is not reclassified as an expected break", () => {
  assert.equal(
    state("2026-07-29T12:15:00.000Z", [
      session("2026-07-29T07:00:00.000Z", "2026-07-29T11:59:00.000Z"),
    ]).status,
    "none"
  );
});

test("late return is visible as an admin break exception", () => {
  const result = state("2026-07-29T13:30:00.000Z", [
    session("2026-07-29T07:00:00.000Z", "2026-07-29T12:15:00.000Z"),
    session("2026-07-29T13:20:00.000Z"),
  ]);
  assert.equal(result.status, "returned_late");
  assert.equal(result.returnAt, "2026-07-29T13:20:00.000Z");
  assert.equal(result.returnDueAt, "2026-07-29T13:15:00.000Z");
});

test("employee who never returns is expected during grace and late afterward", () => {
  const sessions = [
    session("2026-07-29T07:00:00.000Z", "2026-07-29T12:10:00.000Z"),
  ];
  assert.equal(state("2026-07-29T13:15:00.000Z", sessions).status, "expected_break");
  assert.equal(state("2026-07-29T13:16:00.000Z", sessions).status, "not_returned");
});

test("multiple leave and re-entry cycles use ordinary sessions and the latest unmatched departure", () => {
  const completeCycles = [
    session("2026-07-29T07:00:00.000Z", "2026-07-29T12:05:00.000Z"),
    session("2026-07-29T12:20:00.000Z", "2026-07-29T12:40:00.000Z"),
    session("2026-07-29T12:55:00.000Z"),
  ];
  assert.equal(state("2026-07-29T13:00:00.000Z", completeCycles).status, "none");

  const latestOpenCycle = completeCycles.map((item, index) =>
    index === 2 ? { ...item, clockInAt: null } : item
  );
  assert.equal(state("2026-07-29T13:00:00.000Z", latestOpenCycle).status, "expected_break");
});

test("monitoring remains active after a lunch clock-out regardless of break configuration", () => {
  const planInput = {
    now: "2026-07-29T12:20:00.000Z",
    days: [{
      workDate: "2026-07-29",
      scheduledStart: "2026-07-29T07:00:00.000Z",
      scheduledEnd: "2026-07-29T15:30:00.000Z",
      resolved: false,
    }],
    monitoringLeadMinutes: 120,
    endOfDayCutoffMinutes: 180,
    hasMonitorableJob: true,
  };

  const lunchDeparture = [
    session("2026-07-29T07:00:00.000Z", "2026-07-29T12:10:00.000Z"),
  ];
  assert.equal(state(planInput.now, lunchDeparture).status, "expected_break");
  assert.equal(
    state(planInput.now, lunchDeparture, { startTime: null, endTime: null }).status,
    "none"
  );
  assert.equal(computeMonitoringPlan(planInput).active, true);
  assert.equal(computeMonitoringPlan({ ...planInput, days: [{ ...planInput.days[0], resolved: true }] }).active, true);
});

test("company break persistence is optional, paired, bounded, and admin-only", () => {
  const root = process.cwd();
  const migration = readFileSync(
    join(root, "supabase/migrations/20260729_01_company_break_schedule.sql"),
    "utf8"
  );
  const companyRoute = readFileSync(join(root, "app/api/company/settings/route.ts"), "utf8");
  const memberAttendanceRoute = readFileSync(join(root, "app/api/attendance/settings/route.ts"), "utf8");

  assert.match(migration, /attendance_break_start_time time without time zone/);
  assert.match(migration, /attendance_break_end_time time without time zone/);
  assert.match(migration, /attendance_break_start_time is null and attendance_break_end_time is null/);
  assert.match(migration, /attendance_break_start_time < attendance_break_end_time/);
  assert.match(migration, /attendance_break_return_grace_minutes between 0 and 240/);

  assert.match(companyRoute, /requireRole\(\["admin"\]\)/);
  assert.match(companyRoute, /attendance_break_start_time/);
  assert.match(companyRoute, /attendance_break_end_time/);
  assert.match(companyRoute, /attendance_break_return_grace_minutes/);
  assert.ok(!memberAttendanceRoute.includes("attendance_break_"));
});
