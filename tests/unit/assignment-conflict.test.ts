import test from "node:test";
import assert from "node:assert/strict";
import {
  ASSIGNMENT_CONFLICT_CODE,
  evaluateAssignmentConflict,
  isActiveJobStatus,
  jobScheduleFromRow,
  schedulesConflict,
  toConflictJob,
} from "../../src/lib/jobs/assignmentConflict.ts";

const job = (over: Partial<ReturnType<typeof toConflictJob>> = {}) => ({
  id: "j1",
  name: "Job",
  status: "in_progress",
  startAt: null as string | null,
  endAt: null as string | null,
  ...over,
});

test("isActiveJobStatus recognizes active statuses only", () => {
  for (const s of ["in_progress", "active", "open", "IN_PROGRESS", " Active "]) {
    assert.equal(isActiveJobStatus(s), true, `${s} should be active`);
  }
  for (const s of ["draft", "sent", "approved", "completed", "canceled", "", null, undefined]) {
    assert.equal(isActiveJobStatus(s), false, `${String(s)} should be inactive`);
  }
});

test("schedulesConflict: overlapping ranges conflict, disjoint ranges do not", () => {
  assert.equal(
    schedulesConflict({ startAt: "2026-01-01", endAt: "2026-01-10" }, { startAt: "2026-01-05", endAt: "2026-01-15" }),
    true
  );
  assert.equal(
    schedulesConflict({ startAt: "2026-01-01", endAt: "2026-01-10" }, { startAt: "2026-02-01", endAt: "2026-02-10" }),
    false
  );
  // Touching boundaries count as overlapping (inclusive).
  assert.equal(
    schedulesConflict({ startAt: "2026-01-01", endAt: "2026-01-10" }, { startAt: "2026-01-10", endAt: "2026-01-20" }),
    true
  );
});

test("schedulesConflict: indeterminate (missing/invalid) schedules count as conflict", () => {
  assert.equal(schedulesConflict({ startAt: null, endAt: null }, { startAt: "2026-01-01", endAt: "2026-01-10" }), true);
  assert.equal(schedulesConflict({ startAt: "2026-01-01", endAt: null }, { startAt: "2026-01-01", endAt: "2026-01-10" }), true);
  // Inverted range is invalid → indeterminate → conflict.
  assert.equal(schedulesConflict({ startAt: "2026-01-10", endAt: "2026-01-01" }, { startAt: "2026-01-01", endAt: "2026-01-10" }), true);
});

test("no conflict when the target job is not active", () => {
  const result = evaluateAssignmentConflict({
    employeeId: "e1",
    targetJob: job({ id: "target", status: "draft" }),
    existingJobs: [job({ id: "other", status: "in_progress" })],
  });
  assert.equal(result, null);
});

test("no conflict against non-active existing jobs", () => {
  const result = evaluateAssignmentConflict({
    employeeId: "e1",
    targetJob: job({ id: "target", startAt: "2026-01-01", endAt: "2026-01-10" }),
    existingJobs: [job({ id: "other", status: "completed", startAt: "2026-01-01", endAt: "2026-01-10" })],
  });
  assert.equal(result, null);
});

test("non-overlapping active jobs are allowed", () => {
  const result = evaluateAssignmentConflict({
    employeeId: "e1",
    targetJob: job({ id: "target", startAt: "2026-03-01", endAt: "2026-03-10" }),
    existingJobs: [job({ id: "other", startAt: "2026-01-01", endAt: "2026-01-10" })],
  });
  assert.equal(result, null);
});

test("two active jobs with overlapping schedules conflict, and the response identifies the existing job", () => {
  const result = evaluateAssignmentConflict({
    employeeId: "e1",
    targetJob: job({ id: "target", startAt: "2026-01-05", endAt: "2026-01-15" }),
    existingJobs: [job({ id: "other", name: "Bridge Repair", startAt: "2026-01-01", endAt: "2026-01-10" })],
  });
  assert.ok(result);
  assert.equal(result?.code, ASSIGNMENT_CONFLICT_CODE);
  assert.equal(result?.employeeId, "e1");
  assert.deepEqual(result?.conflictingJob, {
    id: "other",
    name: "Bridge Repair",
    startAt: "2026-01-01",
    endAt: "2026-01-10",
  });
});

test("two active jobs with no schedules conflict (current active-job membership fallback)", () => {
  const result = evaluateAssignmentConflict({
    employeeId: "e1",
    targetJob: job({ id: "target" }),
    existingJobs: [job({ id: "other", name: "Warehouse" })],
  });
  assert.ok(result);
  assert.equal(result?.conflictingJob.id, "other");
});

test("the target job never conflicts with itself", () => {
  const result = evaluateAssignmentConflict({
    employeeId: "e1",
    targetJob: job({ id: "same" }),
    existingJobs: [job({ id: "same" })],
  });
  assert.equal(result, null);
});

test("jobScheduleFromRow tolerates the several column-name variants", () => {
  assert.deepEqual(jobScheduleFromRow({ start_date: "2026-01-01", end_date: "2026-01-10" }), {
    startAt: "2026-01-01",
    endAt: "2026-01-10",
  });
  assert.deepEqual(jobScheduleFromRow({ startDate: "2026-01-01", target_end_date: "2026-01-10" }), {
    startAt: "2026-01-01",
    endAt: "2026-01-10",
  });
  assert.deepEqual(jobScheduleFromRow({ starts_at: "2026-01-01T08:00:00Z", ends_at: "2026-01-01T17:00:00Z" }), {
    startAt: "2026-01-01T08:00:00Z",
    endAt: "2026-01-01T17:00:00Z",
  });
  assert.deepEqual(jobScheduleFromRow({ name: "no dates" }), { startAt: null, endAt: null });
});
