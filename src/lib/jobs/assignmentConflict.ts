export const ASSIGNMENT_CONFLICT_CODE = "EMPLOYEE_ASSIGNMENT_CONFLICT" as const;

// Keep this list aligned with the jobs UI's active filter. Schedule dates are
// deliberately irrelevant: an employee can belong to only one active job.
export const ACTIVE_JOB_STATUSES = ["in_progress", "active", "open", "approved"] as const;

const ACTIVE_STATUS_SET = new Set<string>(ACTIVE_JOB_STATUSES);

export function isActiveJobStatus(status: unknown): boolean {
  return ACTIVE_STATUS_SET.has(String(status ?? "").trim().toLowerCase());
}
export type ActiveJobAssignment = {
  id: string;
  name: string;
  status: string | null;
};

export function findActiveAssignmentConflict(params: {
  targetJobId: string;
  targetStatus: unknown;
  existingJobs: ActiveJobAssignment[];
}): ActiveJobAssignment | null {
  if (!isActiveJobStatus(params.targetStatus)) return null;

  return (
    params.existingJobs.find(
      (job) =>
        String(job.id) !== String(params.targetJobId) && isActiveJobStatus(job.status),
    ) ?? null
  );
}
