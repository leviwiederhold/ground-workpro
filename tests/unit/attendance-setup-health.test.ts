import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateEmployeeSetup,
  SETUP_PROBLEM_FIX,
  SETUP_PROBLEM_LABEL,
  STALE_DEVICE_HOURS,
  summarizeSetupHealth,
  type EmployeeSetupInput,
} from "../../src/lib/attendance/setupHealth.ts";

const NOW = "2026-07-21T12:00:00.000Z";
const hoursAgo = (h: number) => new Date(Date.parse(NOW) - h * 3600_000).toISOString();

function employee(over: Partial<EmployeeSetupInput> = {}): EmployeeSetupInput {
  return {
    employeeId: "emp-1",
    name: "Dave",
    hasAssignmentToday: true,
    jobsiteVerified: true,
    jobName: "Smith Excavation",
    credential: {
      expiresAt: "2026-08-20T00:00:00.000Z",
      revokedAt: null,
      lastUsedAt: hoursAgo(2),
    },
    automaticAttendanceEnabled: true,
    ...over,
  };
}

test("a fully set-up employee has no problems", () => {
  const result = evaluateEmployeeSetup(employee(), NOW);
  assert.equal(result.healthy, true);
  assert.deepEqual(result.problems, []);
});

test("a missing assignment is reported alone, not with its own consequences", () => {
  const result = evaluateEmployeeSetup(
    employee({ hasAssignmentToday: false, jobsiteVerified: false, credential: null }),
    NOW
  );
  assert.deepEqual(result.problems, ["no_assignment"]);
});

test("an unverified jobsite is reported", () => {
  const result = evaluateEmployeeSetup(employee({ jobsiteVerified: false }), NOW);
  assert.deepEqual(result.problems, ["jobsite_unverified"]);
  assert.equal(result.healthy, false);
});

test("a phone that was never enrolled is reported", () => {
  const result = evaluateEmployeeSetup(employee({ credential: null }), NOW);
  assert.deepEqual(result.problems, ["device_not_enrolled"]);
});

test("a revoked credential counts as not enrolled", () => {
  const result = evaluateEmployeeSetup(
    employee({ credential: { expiresAt: "2026-08-20T00:00:00.000Z", revokedAt: hoursAgo(1), lastUsedAt: hoursAgo(2) } }),
    NOW
  );
  assert.deepEqual(result.problems, ["device_not_enrolled"]);
});

test("an expired credential is distinguished from one that was never set up", () => {
  const result = evaluateEmployeeSetup(
    employee({ credential: { expiresAt: hoursAgo(1), revokedAt: null, lastUsedAt: hoursAgo(2) } }),
    NOW
  );
  assert.deepEqual(result.problems, ["credential_expired"]);
});

test("a phone that has gone silent is flagged", () => {
  const silent = evaluateEmployeeSetup(
    employee({ credential: { expiresAt: "2026-08-20T00:00:00.000Z", revokedAt: null, lastUsedAt: hoursAgo(STALE_DEVICE_HOURS + 1) } }),
    NOW
  );
  assert.deepEqual(silent.problems, ["no_recent_device_activity"]);

  // A weekend off must not flag the whole crew on Monday.
  const quietButFine = evaluateEmployeeSetup(
    employee({ credential: { expiresAt: "2026-08-20T00:00:00.000Z", revokedAt: null, lastUsedAt: hoursAgo(STALE_DEVICE_HOURS - 1) } }),
    NOW
  );
  assert.equal(quietButFine.healthy, true);
});

test("an enrolled phone that has never reported is flagged", () => {
  const result = evaluateEmployeeSetup(
    employee({ credential: { expiresAt: "2026-08-20T00:00:00.000Z", revokedAt: null, lastUsedAt: null } }),
    NOW
  );
  assert.deepEqual(result.problems, ["no_recent_device_activity"]);
});

test("multiple independent problems are all reported", () => {
  const result = evaluateEmployeeSetup(employee({ jobsiteVerified: false, credential: null }), NOW);
  assert.deepEqual(result.problems, ["jobsite_unverified", "device_not_enrolled"]);
});

test("with the company switch off, nothing is reported as broken", () => {
  // Automatic attendance is not in use, so setup problems would be pure noise.
  const result = evaluateEmployeeSetup(
    employee({ automaticAttendanceEnabled: false, jobsiteVerified: false, credential: null }),
    NOW
  );
  assert.equal(result.healthy, true);
  assert.deepEqual(result.problems, []);
});

test("the summary lists only broken employees, worst first", () => {
  const summary = summarizeSetupHealth(
    [
      employee({ employeeId: "ok", name: "Ana" }),
      employee({ employeeId: "one", name: "Zoe", jobsiteVerified: false }),
      employee({ employeeId: "two", name: "Bob", jobsiteVerified: false, credential: null }),
    ],
    NOW
  );

  assert.equal(summary.brokenCount, 2);
  assert.equal(summary.healthyCount, 1);
  assert.deepEqual(
    summary.items.map((i) => i.name),
    ["Bob", "Zoe"] // two problems before one
  );
});

test("employees with equally many problems are listed alphabetically", () => {
  const summary = summarizeSetupHealth(
    [
      employee({ employeeId: "b", name: "Zoe", credential: null }),
      employee({ employeeId: "a", name: "Ana", credential: null }),
    ],
    NOW
  );
  assert.deepEqual(
    summary.items.map((i) => i.name),
    ["Ana", "Zoe"]
  );
});

test("an all-healthy company reports nothing to act on", () => {
  const summary = summarizeSetupHealth([employee(), employee({ employeeId: "emp-2", name: "Ana" })], NOW);
  assert.equal(summary.brokenCount, 0);
  assert.deepEqual(summary.items, []);
});

test("every problem has a label and an actionable fix", () => {
  for (const problem of Object.keys(SETUP_PROBLEM_LABEL) as Array<keyof typeof SETUP_PROBLEM_LABEL>) {
    assert.ok(SETUP_PROBLEM_LABEL[problem]);
    assert.ok(SETUP_PROBLEM_FIX[problem], `${problem} has no fix instruction`);
  }
});

test("the setup report never carries a location", () => {
  // A manager needs to know attendance is broken, not where anyone is. This
  // guards against a coordinate being added to the payload later.
  const result = evaluateEmployeeSetup(employee({ jobsiteVerified: false }), NOW);
  const serialized = JSON.stringify(result);
  for (const forbidden of ["lat", "lng", "latitude", "longitude", "distance", "accuracy"]) {
    assert.ok(!serialized.toLowerCase().includes(forbidden), `setup health leaked ${forbidden}`);
  }
});
