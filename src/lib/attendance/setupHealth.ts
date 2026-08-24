// Authoritative automatic-attendance setup contract (pure).
//
// One employee population and one evaluator feed both the CEO configured count
// and the actionable warning list. The report contains readiness facts only —
// never coordinates, distances, or continuous location history.

export type SetupProblem =
  | "no_app_access"
  | "no_assignment"
  | "jobsite_unverified"
  | "native_readiness_missing"
  | "background_location_required"
  | "precise_location_required"
  | "native_service_unhealthy"
  | "device_not_enrolled"
  | "credential_expired"
  | "regions_not_registered";

export const SETUP_PROBLEM_LABEL: Record<SetupProblem, string> = {
  no_app_access: "No app access",
  no_assignment: "Not assigned to a job",
  jobsite_unverified: "Jobsite address not verified",
  native_readiness_missing: "Phone setup has not reported",
  background_location_required: "Background location needs setup",
  precise_location_required: "Precise Location needs setup",
  native_service_unhealthy: "Native location service is unavailable",
  device_not_enrolled: "Phone not set up for automatic attendance",
  credential_expired: "Phone needs to sign in again",
  regions_not_registered: "Assigned jobsite is not registered on the phone",
};

export const SETUP_PROBLEM_FIX: Record<SetupProblem, string> = {
  no_app_access: "Invite the employee to the company app before configuring their phone.",
  no_assignment: "Assign the employee to a job for this workday.",
  jobsite_unverified: "Open the job and verify its address so the jobsite has real coordinates.",
  native_readiness_missing: "Ask the employee to complete the one-time location setup in the current app.",
  background_location_required: "Ask the employee to set Location access to Always.",
  precise_location_required: "Ask the employee to enable Precise Location.",
  native_service_unhealthy: "Confirm Location Services and Background App Refresh are enabled for the app.",
  device_not_enrolled: "Ask the employee to open the app and complete location setup.",
  credential_expired: "Ask the employee to open the app to re-enroll their phone.",
  regions_not_registered: "Ask the employee to open the app once while assigned jobs are available.",
};

export type NativeReadinessReport = {
  locationServicesEnabled: boolean | null;
  backgroundRefreshEnabled: boolean | null;
  background: string;
  precise: boolean | null;
  serviceSupported: boolean | null;
  serviceHealthy: boolean | null;
  hasSecureCredential: boolean | null;
  requiredRegionIds: string[];
  registeredRegionIds: string[];
  reportedAt: string | null;
};

export type EmployeeSetupInput = {
  employeeId: string;
  userId: string | null;
  name: string;
  hasAppAccess: boolean;
  hasAssignmentToday: boolean;
  jobsiteVerified: boolean;
  jobName: string | null;
  // Server-derived region identifiers for the assigned job. These are the
  // authority; a phone cannot make itself healthy by reporting a smaller
  // required set.
  requiredRegionIds: string[];
  credential: {
    expiresAt: string | null;
    revokedAt: string | null;
    lastUsedAt: string | null;
  } | null;
  nativeReadiness: NativeReadinessReport | null;
  // Latest accepted event delivered by the native credential path. This is
  // operational evidence, not an onboarding flag, and contains no location.
  latestNativeActivityAt: string | null;
  automaticAttendanceEnabled: boolean;
};

export type EmployeeSetupHealth = {
  employeeId: string;
  userId: string | null;
  name: string;
  jobName: string | null;
  problems: SetupProblem[];
  healthy: boolean;
  configured: boolean;
  readinessReportedAt: string | null;
};

const unique = (values: string[]) => [...new Set(values)].sort();

/**
 * Setup problems for one employee, most blocking first.
 *
 * App access defines participation in the CEO configured count. Assignment
 * remains first because native regions cannot be required without a job.
 */
export function evaluateEmployeeSetup(
  input: EmployeeSetupInput,
  now: string = new Date().toISOString(),
): EmployeeSetupHealth {
  const base = {
    employeeId: input.employeeId,
    userId: input.userId,
    name: input.name,
    jobName: input.jobName,
    readinessReportedAt: input.nativeReadiness?.reportedAt ?? null,
  };
  const result = (problems: SetupProblem[]): EmployeeSetupHealth => ({
    ...base,
    problems,
    healthy: problems.length === 0,
    configured: problems.length === 0,
  });

  if (!input.automaticAttendanceEnabled) return result([]);
  if (!input.hasAppAccess) return result(["no_app_access"]);
  if (!input.hasAssignmentToday) return result(["no_assignment"]);

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
    }
  }

  const readiness = input.nativeReadiness;
  const nowMs = Date.parse(now);
  const activityMs = Date.parse(input.latestNativeActivityAt ?? "");
  const reportMs = Date.parse(readiness?.reportedAt ?? "");
  // A recent accepted native event proves that the credential, background
  // delivery, and registered region actually worked. It may supersede a
  // missing/stale readiness report, but never a newer explicit failure report.
  const hasCurrentNativeEvidence =
    Number.isFinite(activityMs) &&
    activityMs >= nowMs - 14 * 24 * 60 * 60 * 1000 &&
    (!Number.isFinite(reportMs) || activityMs >= reportMs);
  if (!readiness?.reportedAt) {
    if (!hasCurrentNativeEvidence) {
      problems.push("native_readiness_missing");
      return result(problems);
    }
  }
  if (!hasCurrentNativeEvidence && (
    readiness?.serviceSupported !== true ||
    readiness?.serviceHealthy !== true ||
    readiness?.locationServicesEnabled !== true ||
    readiness?.backgroundRefreshEnabled !== true
  )) {
    problems.push("native_service_unhealthy");
  }
  if (!hasCurrentNativeEvidence && readiness?.background !== "granted") {
    problems.push("background_location_required");
  }
  if (!hasCurrentNativeEvidence && readiness?.precise !== true) {
    problems.push("precise_location_required");
  }
  if (!hasCurrentNativeEvidence && readiness?.hasSecureCredential !== true && !problems.includes("device_not_enrolled")) {
    problems.push("device_not_enrolled");
  }

  const required = unique(input.requiredRegionIds);
  const nativeRequired = new Set(unique(readiness?.requiredRegionIds ?? []));
  const registered = new Set(unique(readiness?.registeredRegionIds ?? []));
  if (!hasCurrentNativeEvidence && (
    required.length === 0 ||
    !required.every(
      (identifier) =>
        nativeRequired.has(identifier) && registered.has(identifier),
    )
  )) {
    problems.push("regions_not_registered");
  }

  return result(problems);
}

export type SetupHealthSummary = {
  // Full app-access population. Both CEO surfaces must use this exact array.
  items: EmployeeSetupHealth[];
  brokenCount: number;
  healthyCount: number;
  configuredCount: number;
  totalCount: number;
};

export function summarizeSetupHealth(
  employees: EmployeeSetupInput[],
  now?: string,
): SetupHealthSummary {
  const items = employees
    .filter((employee) => employee.hasAppAccess)
    .map((employee) => evaluateEmployeeSetup(employee, now))
    .sort((a, b) => a.name.localeCompare(b.name));
  const configuredCount = items.filter((item) => item.configured).length;
  return {
    items,
    brokenCount: items.length - configuredCount,
    healthyCount: configuredCount,
    configuredCount,
    totalCount: items.length,
  };
}
