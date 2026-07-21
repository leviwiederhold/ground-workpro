import test from "node:test";
import assert from "node:assert/strict";
import {
  canCorrectAttendance,
  CORRECTION_TYPES,
  CORRECTION_TYPE_LABEL,
  describeCorrection,
  isNoOpCorrection,
  MIN_REASON_LENGTH,
  planCorrection,
  reconstructOriginal,
  validateCorrection,
  type CorrectionRecord,
  type TimecardSnapshot,
} from "../../src/lib/attendance/corrections.ts";

const NOW = "2026-07-22T15:00:00.000Z";
const REASON = "Employee reported the clock-out did not register.";

function snapshot(over: Partial<TimecardSnapshot> = {}): TimecardSnapshot {
  return {
    id: "tc-1",
    jobId: "job-1",
    workDate: "2026-07-21",
    clockInAt: "2026-07-21T11:00:00.000Z",
    clockOutAt: null,
    breakStartAt: null,
    breakEndAt: null,
    status: "needs_review",
    ...over,
  };
}

// ── A reason is mandatory ────────────────────────────────────────────────────

test("a correction without a reason is rejected", () => {
  const result = validateCorrection({
    correctionType: "missing_clock_out",
    values: { clockOutAt: "2026-07-21T20:00:00.000Z" },
  });
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && result.errors.reason);
});

test("a token reason is rejected — it would be unreadable in a dispute", () => {
  const result = validateCorrection({
    correctionType: "missing_clock_out",
    reason: "fix",
    values: { clockOutAt: "2026-07-21T20:00:00.000Z" },
  });
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && result.errors.reason.includes(String(MIN_REASON_LENGTH)));
});

test("a real reason is accepted and trimmed", () => {
  const result = validateCorrection({
    correctionType: "missing_clock_out",
    reason: `  ${REASON}  `,
    values: { clockOutAt: "2026-07-21T20:00:00.000Z" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok === true && result.request.reason, REASON);
});

// ── Each type must supply what it claims to correct ──────────────────────────

test("a correction must actually carry the value its type names", () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ["missing_clock_in", {}, "clockInAt"],
    ["missing_clock_out", {}, "clockOutAt"],
    ["incorrect_job", {}, "jobId"],
    ["incorrect_timestamp", {}, "values"],
  ];
  for (const [correctionType, values, expectedError] of cases) {
    const result = validateCorrection({ correctionType, reason: REASON, values });
    assert.equal(result.ok, false, correctionType);
    assert.ok(result.ok === false && result.errors[expectedError], `${correctionType} missing ${expectedError}`);
  }
});

test("voiding types carry no values, and that is valid", () => {
  for (const correctionType of ["duplicate_record", "invalid_record"]) {
    const result = validateCorrection({ correctionType, reason: REASON, values: {} });
    assert.equal(result.ok, true, correctionType);
  }
});

test("an unknown correction type is rejected", () => {
  const result = validateCorrection({ correctionType: "delete_everything", reason: REASON, values: {} });
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && result.errors.correctionType);
});

test("a malformed timestamp is rejected rather than silently coerced", () => {
  const result = validateCorrection({
    correctionType: "incorrect_timestamp",
    reason: REASON,
    values: { clockInAt: "yesterday" },
  });
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && result.errors.clockInAt);
});

test("every correction type has a label", () => {
  for (const type of CORRECTION_TYPES) {
    assert.ok(CORRECTION_TYPE_LABEL[type], `${type} has no label`);
  }
});

// ── The original is always preserved ─────────────────────────────────────────

test("a correction records the value it replaced, not just the new one", () => {
  const current = snapshot();
  const plan = planCorrection(
    { correctionType: "missing_clock_out", reason: REASON, values: { clockOutAt: "2026-07-21T20:00:00.000Z" } },
    current,
    "manager-1",
    NOW
  );

  assert.equal(plan.originalValues.clockOutAt, null); // it was missing
  assert.equal(plan.newValues.clockOutAt, "2026-07-21T20:00:00.000Z");
  assert.equal(plan.update.clock_out_at, "2026-07-21T20:00:00.000Z");
  // Who and when are on the effective record too.
  assert.equal(plan.update.corrected_by, "manager-1");
  assert.equal(plan.update.corrected_at, NOW);
});

test("a correction only captures the fields it touches", () => {
  const plan = planCorrection(
    { correctionType: "incorrect_timestamp", reason: REASON, values: { clockInAt: "2026-07-21T11:30:00.000Z" } },
    snapshot({ clockOutAt: "2026-07-21T20:00:00.000Z" }),
    "manager-1",
    NOW
  );
  assert.ok("clockInAt" in plan.originalValues);
  assert.ok(!("clockOutAt" in plan.newValues), "an untouched field must not be restated");
});

test("correcting the job preserves the original job id", () => {
  const plan = planCorrection(
    { correctionType: "incorrect_job", reason: REASON, values: { jobId: "job-2" } },
    snapshot({ jobId: "job-1" }),
    "manager-1",
    NOW
  );
  assert.equal(plan.originalValues.jobId, "job-1");
  assert.equal(plan.update.job_id, "job-2");
});

test("voiding a record rejects it without rewriting any timestamp", () => {
  const plan = planCorrection(
    { correctionType: "duplicate_record", reason: REASON, values: {} },
    snapshot({ clockOutAt: "2026-07-21T20:00:00.000Z", status: "active" }),
    "manager-1",
    NOW
  );
  assert.equal(plan.update.status, "rejected");
  assert.equal(plan.originalValues.status, "active");
  // The observed times stay exactly as recorded.
  assert.ok(!("clock_in_at" in plan.update));
  assert.ok(!("clock_out_at" in plan.update));
  assert.equal(plan.eventType, "rejected");
});

test("a corrected record leaves needs_review but is not auto-approved", () => {
  const plan = planCorrection(
    { correctionType: "missing_clock_out", reason: REASON, values: { clockOutAt: "2026-07-21T20:00:00.000Z" } },
    snapshot({ status: "needs_review" }),
    "manager-1",
    NOW
  );
  assert.equal(plan.update.status, "pending_review");
  assert.notEqual(plan.update.status, "approved");
});

test("an already-approved record is not knocked back to review by a correction", () => {
  const plan = planCorrection(
    { correctionType: "incorrect_timestamp", reason: REASON, values: { clockInAt: "2026-07-21T11:30:00.000Z" } },
    snapshot({ status: "approved" }),
    "manager-1",
    NOW
  );
  assert.ok(!("status" in plan.newValues));
});

// ── No-op corrections ────────────────────────────────────────────────────────

test("a correction that changes nothing is detected", () => {
  const current = snapshot({ clockOutAt: "2026-07-21T20:00:00.000Z", status: "approved" });
  const plan = planCorrection(
    { correctionType: "missing_clock_out", reason: REASON, values: { clockOutAt: "2026-07-21T20:00:00.000Z" } },
    current,
    "manager-1",
    NOW
  );
  // Recording it would claim a change that never happened.
  assert.equal(isNoOpCorrection(plan), true);
});

test("a correction that changes something is not a no-op", () => {
  const plan = planCorrection(
    { correctionType: "missing_clock_out", reason: REASON, values: { clockOutAt: "2026-07-21T20:00:00.000Z" } },
    snapshot(),
    "manager-1",
    NOW
  );
  assert.equal(isNoOpCorrection(plan), false);
});

// ── Reading the trail back ───────────────────────────────────────────────────

function correction(over: Partial<CorrectionRecord> = {}): CorrectionRecord {
  return {
    id: "c-1",
    correctionType: "missing_clock_out",
    reason: REASON,
    originalValues: { clockOutAt: null },
    newValues: { clockOutAt: "2026-07-21T20:00:00.000Z" },
    correctedBy: "manager-1",
    correctedAt: NOW,
    ...over,
  };
}

test("a correction's changes are described field by field", () => {
  const diffs = describeCorrection(correction());
  assert.equal(diffs.length, 1);
  assert.deepEqual(diffs[0], { field: "clockOutAt", from: null, to: "2026-07-21T20:00:00.000Z" });
});

test("unchanged fields are not reported as changes", () => {
  const diffs = describeCorrection(
    correction({ originalValues: { clockOutAt: null, status: "active" }, newValues: { clockOutAt: "2026-07-21T20:00:00.000Z", status: "active" } })
  );
  assert.deepEqual(diffs.map((d) => d.field), ["clockOutAt"]);
});

test("the originally recorded values can be reconstructed from the trail", () => {
  const current = snapshot({ clockInAt: "2026-07-21T11:30:00.000Z", clockOutAt: "2026-07-21T20:00:00.000Z" });
  const original = reconstructOriginal(current, [
    correction({ id: "c-1", originalValues: { clockOutAt: null }, correctedAt: "2026-07-22T10:00:00.000Z" }),
    correction({
      id: "c-2",
      correctionType: "incorrect_timestamp",
      originalValues: { clockInAt: "2026-07-21T11:00:00.000Z" },
      newValues: { clockInAt: "2026-07-21T11:30:00.000Z" },
      correctedAt: "2026-07-22T11:00:00.000Z",
    }),
  ]);

  // What the automatic system actually observed, before any manager touched it.
  assert.equal(original.clockInAt, "2026-07-21T11:00:00.000Z");
  assert.equal(original.clockOutAt, null);
  // The corrected record is untouched by the reconstruction.
  assert.equal(current.clockInAt, "2026-07-21T11:30:00.000Z");
});

test("two corrections to the same field rewind to the earliest original", () => {
  const current = snapshot({ clockInAt: "2026-07-21T12:00:00.000Z" });
  const original = reconstructOriginal(current, [
    correction({
      id: "c-1",
      correctionType: "incorrect_timestamp",
      originalValues: { clockInAt: "2026-07-21T11:00:00.000Z" },
      newValues: { clockInAt: "2026-07-21T11:30:00.000Z" },
      correctedAt: "2026-07-22T10:00:00.000Z",
    }),
    correction({
      id: "c-2",
      correctionType: "incorrect_timestamp",
      originalValues: { clockInAt: "2026-07-21T11:30:00.000Z" },
      newValues: { clockInAt: "2026-07-21T12:00:00.000Z" },
      correctedAt: "2026-07-22T11:00:00.000Z",
    }),
  ]);
  assert.equal(original.clockInAt, "2026-07-21T11:00:00.000Z");
});

test("with no corrections the original is the current record", () => {
  const current = snapshot();
  assert.deepEqual(reconstructOriginal(current, []), current);
});

// ── Authorization ────────────────────────────────────────────────────────────

test("only managers may correct attendance", () => {
  assert.equal(canCorrectAttendance("admin"), true);
  assert.equal(canCorrectAttendance("pm"), true);
  assert.equal(canCorrectAttendance("PM"), true);
});

test("field roles and unauthenticated callers may not correct attendance", () => {
  // Reading a roster and rewriting payroll are not the same privilege — foreman
  // can view timecards but must not be able to change them.
  for (const role of ["foreman", "operator", "mechanic", "", null, undefined, "superuser"]) {
    assert.equal(canCorrectAttendance(role), false, `${role} must not be able to correct attendance`);
  }
});
