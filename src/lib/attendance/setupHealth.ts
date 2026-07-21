// Which employees have broken or incomplete automatic-attendance setup (pure).
//
// A manager needs to know that Dave's attendance will not record BEFORE payroll
// day, not after. This derives per-employee setup problems from facts the
// SERVER can see — assignment, jobsite verification, device enrollment, and
// whether the device has actually reported anything — so the answer does not
// depend on the employee having the app open.
//
// Privacy: this is a setup report, not a location report. It carries no
// coordinates, no distances, and no location history — only whether the pieces
// required to record attendance exist. Never add a position to it.

export type SetupProblem =
  | "no_assignment"
  | "jobsite_unverified"
  | "device_not_enrolled"
  | "credential_expired"
  | "no_recent_device_activity";

export const SETUP_PROBLEM_LABEL: Record<SetupProblem, string> = {
  no_assignment: "Not assigned to a job",
  jobsite_unverified: "Jobsite address not verified",
  device_not_enrolled: "Phone not set up for automatic attendance",
  credential_expired: "Phone needs to sign in again",
  no_recent_device_activity: "Phone has not reported in",
};

export const SETUP_PROBLEM_FIX: Record<SetupProblem, string> = {
  no_assignment: "Assign the employee to a job for this workday.",
  jobsite_unverified: "Open the job and verify its address so the jobsite has real coordinates.",
  device_not_enrolled: "Ask the employee to open the app and allow location access.",
  credential_expired: "Ask the employee to open the app to re-enroll their phone.",
  no_recent_device_activity:
    "The phone has not checked in recently. Confirm the app is installed and location is set to Always.",
};

// A device that has not reported in this long is treated as not reporting. Two
// days spans a weekend off without flagging everyone on Monday morning.
export const STALE_DEVICE_HOURS = 48;

export type EmployeeSetupInput = {
  employeeId: string;
  name: string;
  // Whether the employee has an assignment for the day being reported on.
  hasAssignmentToday: boolean;
  // The assigned job has a verified address with coordinates.
  jobsiteVerified: boolean;
  jobName: string | null;
  // Device credential state (PR 10). null = never enrolled.
  credential: { expiresAt: string | null; revokedAt: string | null; lastUsedAt: string | null } | null;
  // Whether automatic attendance is expected to work for this employee at all —
  // false when the company has it switched off.
  automaticAttendanceEnabled: boolean;
};

export type EmployeeSetupHealth = {
  employeeId: string;
  name: string;
  jobName: string | null;
  problems: SetupProblem[];
  // True when nothing blocks automatic attendance for this employee.
  healthy: boolean;
};

/**
 * Setup problems for one employee, most blocking first.
 *
 * Ordering is deliberate: a missing assignment makes every other check moot, so
 * it is reported alone rather than alongside four consequences of itself.
 */
export function evaluateEmployeeSetup(
  input: EmployeeSetupInput,
  now: string = new Date().toISOString()
): EmployeeSetupHealth {
  const base = { employeeId: input.employeeId, name: input.name, jobName: input.jobName };

  // With the company switch off, nothing is broken — automatic attendance is
  // simply not in use. Reporting problems here would be noise.
  if (!input.automaticAttendanceEnabled) {
    return { ...base, problems: [], healthy: true };
  }

  if (!input.hasAssignmentToday) {
    return { ...base, problems: ["no_assignment"], healthy: false };
  }

  const problems: SetupProblem[] = [];
  if (!input.jobsiteVerified) problems.push("jobsite_unverified");

  const credential = input.credential;
  if (!credential || credential.revokedAt) {
    problems.push("device_not_enrolled");
  } else {
    const expiresAt = credential.expiresAt ? Date.parse(credential.expiresAt) : null;
    const nowMs = Date.parse(now);
    if (expiresAt !== null && Number.isFinite(expiresAt) && expiresAt <= nowMs) {
      problems.push("credential_expired");
    } else {
      const lastUsed = credential.lastUsedAt ? Date.parse(credential.lastUsedAt) : null;
      // Never used, or silent for too long — either way the phone is not
      // reporting, which is what the manager needs to know.
      if (lastUsed === null || !Number.isFinite(lastUsed) || nowMs - lastUsed > STALE_DEVICE_HOURS * 3600_000) {
        problems.push("no_recent_device_activity");
      }
    }
  }

  return { ...base, problems, healthy: problems.length === 0 };
}

/** The employees a manager needs to act on, worst first. */
export function summarizeSetupHealth(
  employees: EmployeeSetupInput[],
  now?: string
): { items: EmployeeSetupHealth[]; brokenCount: number; healthyCount: number } {
  const items = employees.map((employee) => evaluateEmployeeSetup(employee, now));
  const broken = items
    .filter((item) => !item.healthy)
    .sort((a, b) => b.problems.length - a.problems.length || a.name.localeCompare(b.name));
  return {
    items: broken,
    brokenCount: broken.length,
    healthyCount: items.length - broken.length,
  };
}
