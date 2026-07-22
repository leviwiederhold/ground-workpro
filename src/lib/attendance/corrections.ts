// Manager attendance corrections (pure).
//
// Attendance drives payroll, so a correction has to be answerable months later:
// who changed it, when, why, and what the value was before. This module decides
// what a correction is allowed to do and what it must preserve; the API route
// applies it and the database triggers guarantee nothing here can be erased
// afterwards.
//
// The rule that shapes everything: a correction NEVER destroys what it
// corrects. The timecard holds the effective record; the correction rows hold
// how it got there, with the original values attached to each one.

export const CORRECTION_TYPES = [
  "missing_clock_in",
  "missing_clock_out",
  "incorrect_job",
  "incorrect_timestamp",
  "duplicate_record",
  "invalid_record",
] as const;

export type CorrectionType = (typeof CORRECTION_TYPES)[number];

export const CORRECTION_TYPE_LABEL: Record<CorrectionType, string> = {
  missing_clock_in: "Missing clock-in",
  missing_clock_out: "Missing clock-out",
  incorrect_job: "Wrong job",
  incorrect_timestamp: "Wrong time",
  duplicate_record: "Duplicate record",
  invalid_record: "Invalid record",
};

// A correction with a one-word reason is indistinguishable from tampering when
// read back a year later in a payroll dispute. The database enforces the same
// minimum, so a direct write cannot bypass it.
export const MIN_REASON_LENGTH = 10;
export const MAX_REASON_LENGTH = 1000;

// The timecard fields a correction may touch. Anything not listed here cannot
// be changed by this workflow at all.
export type CorrectableFields = {
  clockInAt?: string | null;
  clockOutAt?: string | null;
  jobId?: string | null;
  breakStartAt?: string | null;
  breakEndAt?: string | null;
};

export type TimecardSnapshot = {
  id: string;
  jobId: string | null;
  workDate: string | null;
  clockInAt: string | null;
  clockOutAt: string | null;
  breakStartAt: string | null;
  breakEndAt: string | null;
  status: string;
};

export type CorrectionRequest = {
  correctionType: CorrectionType;
  reason: string;
  values: CorrectableFields;
};

export type CorrectionValidation =
  | { ok: true; request: CorrectionRequest }
  | { ok: false; errors: Record<string, string> };

function isIsoOrNull(value: unknown): boolean {
  if (value === null) return true;
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/**
 * Validate a correction request against the type the manager chose.
 *
 * The per-type field requirements are not bureaucracy: they are what makes the
 * audit trail readable. A correction labelled "missing clock-out" that changed
 * the job would be a lie in the history.
 */
export function validateCorrection(input: unknown): CorrectionValidation {
  if (!input || typeof input !== "object") {
    return { ok: false, errors: { _root: "Body must be an object" } };
  }
  const body = input as Record<string, unknown>;
  const errors: Record<string, string> = {};

  const correctionType = String(body.correctionType ?? "");
  if (!CORRECTION_TYPES.includes(correctionType as CorrectionType)) {
    errors.correctionType = `correctionType must be one of ${CORRECTION_TYPES.join(", ")}`;
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < MIN_REASON_LENGTH) {
    errors.reason = `A reason of at least ${MIN_REASON_LENGTH} characters is required`;
  } else if (reason.length > MAX_REASON_LENGTH) {
    errors.reason = `Reason must be ${MAX_REASON_LENGTH} characters or fewer`;
  }

  const rawValues = (body.values ?? {}) as Record<string, unknown>;
  const values: CorrectableFields = {};
  for (const field of ["clockInAt", "clockOutAt", "breakStartAt", "breakEndAt"] as const) {
    if (rawValues[field] === undefined) continue;
    if (!isIsoOrNull(rawValues[field])) {
      errors[field] = `${field} must be an ISO timestamp or null`;
    } else {
      values[field] = rawValues[field] as string | null;
    }
  }
  if (rawValues.jobId !== undefined) {
    if (rawValues.jobId !== null && typeof rawValues.jobId !== "string" && typeof rawValues.jobId !== "number") {
      errors.jobId = "jobId must be a job id or null";
    } else {
      values.jobId = rawValues.jobId === null ? null : String(rawValues.jobId);
    }
  }

  // Each correction type must actually supply what it claims to correct.
  if (!errors.correctionType) {
    const type = correctionType as CorrectionType;
    if (type === "missing_clock_in" && !values.clockInAt) {
      errors.clockInAt = "A clock-in time is required to correct a missing clock-in";
    }
    if (type === "missing_clock_out" && !values.clockOutAt) {
      errors.clockOutAt = "A clock-out time is required to correct a missing clock-out";
    }
    if (type === "incorrect_job" && !values.jobId) {
      errors.jobId = "The correct job is required";
    }
    if (type === "incorrect_timestamp" && !values.clockInAt && !values.clockOutAt) {
      errors.values = "At least one corrected time is required";
    }
    // duplicate_record and invalid_record carry no new values — they void the
    // record rather than restating it.
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, request: { correctionType: correctionType as CorrectionType, reason, values } };
}

export type CorrectionPlan = {
  // Column patch to apply to the timecard (the EFFECTIVE record).
  update: Record<string, unknown>;
  // The values as they were before, stored on the correction row and never
  // overwritten.
  originalValues: Record<string, unknown>;
  // The values after, stored alongside.
  newValues: Record<string, unknown>;
  // The audit event to append to the immutable trail.
  eventType: "manager_edited" | "rejected";
};

const FIELD_TO_COLUMN: Record<keyof CorrectableFields, string> = {
  clockInAt: "clock_in_at",
  clockOutAt: "clock_out_at",
  jobId: "job_id",
  breakStartAt: "break_start_at",
  breakEndAt: "break_end_at",
};

const SNAPSHOT_FIELD: Record<keyof CorrectableFields, keyof TimecardSnapshot> = {
  clockInAt: "clockInAt",
  clockOutAt: "clockOutAt",
  jobId: "jobId",
  breakStartAt: "breakStartAt",
  breakEndAt: "breakEndAt",
};

/**
 * Turn a validated correction into the exact writes to perform.
 *
 * `originalValues` captures ONLY the fields this correction touches, read from
 * the record as it stands now. That is what makes a chain of corrections
 * replayable: each row says what it changed and what it changed it from.
 */
export function planCorrection(
  request: CorrectionRequest,
  current: TimecardSnapshot,
  actorId: string,
  now: string = new Date().toISOString()
): CorrectionPlan {
  const update: Record<string, unknown> = {
    corrected_at: now,
    corrected_by: actorId,
    // The effective record is now a manager's, not the automatic pipeline's.
    source: "manager_adjusted",
  };
  const originalValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};

  // Voiding types do not restate values — they mark the record rejected and
  // leave every timestamp exactly as recorded, so the trail still shows what
  // the system observed.
  if (request.correctionType === "duplicate_record" || request.correctionType === "invalid_record") {
    originalValues.status = current.status;
    update.status = "rejected";
    newValues.status = "rejected";
    return { update, originalValues, newValues, eventType: "rejected" };
  }

  for (const field of Object.keys(request.values) as Array<keyof CorrectableFields>) {
    const next = request.values[field];
    if (next === undefined) continue;
    originalValues[field] = current[SNAPSHOT_FIELD[field]] ?? null;
    newValues[field] = next;
    update[FIELD_TO_COLUMN[field]] = next;
  }

  // A corrected record is no longer "needs review" — a human just reviewed it.
  // It is not auto-approved either; approval stays a separate, explicit act.
  originalValues.status = current.status;
  if (current.status === "needs_review") {
    update.status = "pending_review";
    newValues.status = "pending_review";
  }

  return { update, originalValues, newValues, eventType: "manager_edited" };
}

/**
 * Whether a correction changed anything at all. A no-op correction would add a
 * row to the permanent history claiming a change that never happened.
 */
export function isNoOpCorrection(plan: CorrectionPlan): boolean {
  return Object.keys(plan.newValues).every(
    (key) => JSON.stringify(plan.newValues[key]) === JSON.stringify(plan.originalValues[key])
  );
}

// ── Reading the trail back ───────────────────────────────────────────────────

export type CorrectionRecord = {
  id: string;
  correctionType: CorrectionType;
  reason: string;
  originalValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
  correctedBy: string;
  correctedAt: string;
};

export type CorrectionDiff = {
  field: string;
  from: unknown;
  to: unknown;
};

/** The concrete field-level changes a correction made, for display. */
export function describeCorrection(correction: CorrectionRecord): CorrectionDiff[] {
  const fields = new Set([
    ...Object.keys(correction.originalValues ?? {}),
    ...Object.keys(correction.newValues ?? {}),
  ]);
  const diffs: CorrectionDiff[] = [];
  for (const field of fields) {
    const from = correction.originalValues?.[field] ?? null;
    const to = correction.newValues?.[field] ?? null;
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    diffs.push({ field, from, to });
  }
  return diffs;
}

/**
 * The record as it was ORIGINALLY observed, reconstructed by rewinding every
 * correction. This is what lets the UI show the automatic system's answer
 * beside the corrected one instead of only the latter.
 */
export function reconstructOriginal(
  current: TimecardSnapshot,
  corrections: CorrectionRecord[]
): TimecardSnapshot {
  // Newest first: unwinding in reverse chronological order returns each field
  // to the value it held before the earliest correction that touched it.
  const ordered = corrections
    .slice()
    .sort((a, b) => Date.parse(b.correctedAt) - Date.parse(a.correctedAt));

  const result: TimecardSnapshot = { ...current };
  for (const correction of ordered) {
    for (const [field, value] of Object.entries(correction.originalValues ?? {})) {
      if (field in result) {
        (result as Record<string, unknown>)[field] = value;
      }
    }
  }
  return result;
}

// ── Authorization ────────────────────────────────────────────────────────────

// Only these roles may correct attendance. Deliberately narrower than the set
// that can VIEW timecards: reading a roster and rewriting payroll are not the
// same privilege.
const CORRECTION_ROLES = new Set(["admin", "pm"]);

export function canCorrectAttendance(role: string | null | undefined): boolean {
  return CORRECTION_ROLES.has(String(role ?? "").toLowerCase());
}
