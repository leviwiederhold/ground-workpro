// Pure domain rules for detecting conflicting employee job assignments.
//
// Conflict rule (the safe initial rule for this product):
//   An employee cannot be a crew member of two simultaneously ACTIVE jobs whose
//   schedules overlap. Two active jobs with valid, non-overlapping date ranges
//   are allowed. When a schedule cannot be proven disjoint — because either job
//   is missing a complete, valid [start, end] range — the assignment is treated
//   as a conflict (current active-job membership is the safe fallback).
//
// Kept side-effect free so the API, the transactional SQL guard (which mirrors
// this logic), and unit tests all share one definition.

export const ASSIGNMENT_CONFLICT_CODE = "EMPLOYEE_ASSIGNMENT_CONFLICT";

// Job statuses that represent a currently-active job. Mirrors the "active"
// status filter used by the jobs list API (in_progress | active | open).
const ACTIVE_JOB_STATUSES = new Set(["in_progress", "active", "open"]);

export function isActiveJobStatus(status: unknown): boolean {
  return ACTIVE_JOB_STATUSES.has(String(status ?? "").trim().toLowerCase());
}

export type ConflictJob = {
  id: string;
  name: string;
  status: string | null;
  startAt: string | null;
  endAt: string | null;
};

export type AssignmentConflict = {
  code: typeof ASSIGNMENT_CONFLICT_CODE;
  employeeId: string;
  conflictingJob: {
    id: string;
    name: string;
    startAt: string | null;
    endAt: string | null;
  };
};

function toTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/**
 * Two schedules conflict when their ranges overlap OR when overlap cannot be
 * proven because either side lacks a complete, valid [start, end] range. The
 * indeterminate → conflict default realizes "current active-job membership" as
 * the fallback when jobs are not explicitly scheduled.
 */
export function schedulesConflict(
  a: { startAt: string | null; endAt: string | null },
  b: { startAt: string | null; endAt: string | null }
): boolean {
  const aStart = toTime(a.startAt);
  const aEnd = toTime(a.endAt);
  const bStart = toTime(b.startAt);
  const bEnd = toTime(b.endAt);

  const aComplete = aStart !== null && aEnd !== null && aStart <= aEnd;
  const bComplete = bStart !== null && bEnd !== null && bStart <= bEnd;
  if (!aComplete || !bComplete) return true; // indeterminate → conflict

  // Inclusive overlap on the two date ranges.
  return aStart <= bEnd && bStart <= aEnd;
}

export type AssignmentConflictInput = {
  employeeId: string;
  targetJob: ConflictJob;
  // Jobs the employee is ALREADY a crew member of (may include the target).
  existingJobs: ConflictJob[];
};

/**
 * Returns the first conflicting assignment, or null if the assignment is
 * allowed. Assigning to (or among) non-active jobs never conflicts; only two
 * simultaneously active, schedule-overlapping jobs do.
 */
export function evaluateAssignmentConflict(
  input: AssignmentConflictInput
): AssignmentConflict | null {
  const { employeeId, targetJob, existingJobs } = input;
  if (!isActiveJobStatus(targetJob.status)) return null;

  for (const job of existingJobs) {
    if (String(job.id) === String(targetJob.id)) continue;
    if (!isActiveJobStatus(job.status)) continue;
    if (schedulesConflict(targetJob, job)) {
      return {
        code: ASSIGNMENT_CONFLICT_CODE,
        employeeId: String(employeeId),
        conflictingJob: {
          id: String(job.id),
          name: job.name,
          startAt: job.startAt,
          endAt: job.endAt,
        },
      };
    }
  }
  return null;
}

/**
 * Derive a job's [startAt, endAt] from a raw jobs row, tolerating the several
 * column-name variants that exist across environments (snake/camel, and the
 * distinct schedule vs. target-end columns).
 */
export function jobScheduleFromRow(row: Record<string, unknown>): {
  startAt: string | null;
  endAt: string | null;
} {
  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = row[key];
      if (value !== null && value !== undefined && String(value).trim() !== "") {
        return String(value);
      }
    }
    return null;
  };
  return {
    startAt: pick("starts_at", "start_date", "startDate"),
    endAt: pick("ends_at", "end_date", "target_end_date", "targetEndDate", "endDate"),
  };
}

/** Map a raw jobs row to the ConflictJob shape used by the rule + response. */
export function toConflictJob(row: Record<string, unknown>): ConflictJob {
  const schedule = jobScheduleFromRow(row);
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    status: row.status === null || row.status === undefined ? null : String(row.status),
    startAt: schedule.startAt,
    endAt: schedule.endAt,
  };
}
