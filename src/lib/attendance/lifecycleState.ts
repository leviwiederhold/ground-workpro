// Automatic attendance lifecycle state (pure).
//
// The employee must be able to tell whether attendance is actually working
// without opening a debug panel — and the app must never claim it is working
// when it is not. Both come from one rule: every state is derived from a real
// signal (permission, coordinates, native registration, credential, queue,
// today's record), and a signal we do not have produces an honest "unknown"
// state rather than an optimistic one.
//
// The state most likely to lie is "Waiting for arrival". Shown loosely it means
// "we have no idea what is happening", which reads to an employee as "the
// system is working and I simply haven't arrived yet". It is therefore gated on
// three separate conditions — see canShowWaitingForArrival().

export const ATTENDANCE_LIFECYCLE_STATES = [
  "automatic_attendance_disabled",
  "permission_setup_required",
  "background_permission_missing",
  "precise_location_unavailable",
  "monitoring_starts_at",
  "monitoring_active",
  "waiting_for_arrival",
  "onsite_before_shift",
  "clocked_in_automatically",
  "departure_pending",
  "clocked_out_automatically",
  "no_assignment_today",
  "jobsite_missing_coordinates",
  "native_geofence_unavailable",
  "offline_events_pending",
  "automatic_attendance_degraded",
  "last_sync_failed",
] as const;

export type AttendanceLifecycleState = (typeof ATTENDANCE_LIFECYCLE_STATES)[number];

// Employee-facing copy. Deliberately non-technical: no geofence, confidence,
// credential, or ingestion vocabulary.
export const LIFECYCLE_LABEL: Record<AttendanceLifecycleState, string> = {
  automatic_attendance_disabled: "Automatic attendance is off",
  permission_setup_required: "Location access needed",
  background_permission_missing: "Background location needed",
  precise_location_unavailable: "Precise location needed",
  monitoring_starts_at: "Monitoring starts later",
  monitoring_active: "Monitoring active",
  waiting_for_arrival: "Waiting for arrival",
  onsite_before_shift: "On site — before shift start",
  clocked_in_automatically: "Clocked in automatically",
  departure_pending: "Leaving the jobsite",
  clocked_out_automatically: "Clocked out automatically",
  no_assignment_today: "No job assigned today",
  jobsite_missing_coordinates: "Jobsite address not verified",
  native_geofence_unavailable: "Automatic detection unavailable",
  offline_events_pending: "Waiting to sync",
  automatic_attendance_degraded: "Automatic attendance needs attention",
  last_sync_failed: "Last sync failed",
};

export const LIFECYCLE_DESCRIPTION: Record<AttendanceLifecycleState, string> = {
  automatic_attendance_disabled:
    "Your company has turned off automatic attendance. Use clock in and out below.",
  permission_setup_required:
    "Allow location access so your arrival and departure can be recorded automatically.",
  background_permission_missing:
    "Set location access to Always so arrivals are recorded while the app is closed.",
  precise_location_unavailable:
    "Turn on precise location so arrivals at the jobsite can be told apart from nearby ones.",
  monitoring_starts_at: "Nothing to do — monitoring turns on before your shift.",
  monitoring_active: "Your arrival at the jobsite will be recorded automatically.",
  waiting_for_arrival: "You are away from the jobsite. Arriving will clock you in automatically.",
  onsite_before_shift: "You have arrived early. You will be clocked in when your shift starts.",
  clocked_in_automatically: "Your arrival was recorded. Leaving will clock you out automatically.",
  departure_pending: "You have left the jobsite. Coming back shortly keeps your shift open.",
  clocked_out_automatically: "Your hours for today are recorded.",
  no_assignment_today: "You are not assigned to a job today, so nothing is being tracked.",
  jobsite_missing_coordinates:
    "Your jobsite address has not been verified, so arrivals cannot be detected. Ask your manager to verify it.",
  native_geofence_unavailable:
    "This device cannot detect arrivals on its own. Use clock in and out below.",
  offline_events_pending: "Some attendance is waiting for a connection. It will sync on its own.",
  automatic_attendance_degraded:
    "Automatic attendance is not fully working. Check the items below, and clock in manually if needed.",
  last_sync_failed: "Your last attendance sync did not go through. It will be retried automatically.",
};

export type PermissionState = "granted" | "denied" | "prompt" | "unavailable" | "unknown";

export type LifecycleInput = {
  // Company master switch.
  automaticAttendanceEnabled: boolean;
  // Today's assignment. Null = nothing assigned.
  hasAssignmentToday: boolean;
  // The assigned jobsite has verified coordinates to monitor against.
  jobsiteHasVerifiedCoordinates: boolean;

  // Permissions as the OS actually reports them.
  foregroundPermission: PermissionState;
  backgroundPermission: PermissionState;
  // null = the platform did not report it (web); false = explicitly coarse.
  preciseLocation: boolean | null;

  // Whether this runtime can do native background geofencing at all, and
  // whether the assigned job's regions are actually registered right now.
  nativeGeofenceSupported: boolean;
  assignedJobGeofenceRegistered: boolean | null;
  // Whether a device credential exists for background submission.
  deviceCredentialActive: boolean | null;

  // Server-computed monitoring window (PR 12's monitoring plan).
  monitoringWindowActive: boolean | null;
  monitoringStartsAt: string | null;

  // Where the employee is, when we can tell. null = no usable fix — which is
  // NOT the same as "outside".
  onsite: boolean | null;

  // Today's record.
  todayCard: {
    clockInAt: string | null;
    clockOutAt: string | null;
    pendingDepartureAt: string | null;
    onsiteBeforeShiftAt: string | null;
  } | null;

  // Offline queue health.
  pendingQueueCount: number;
  lastSyncFailed: boolean;

  manualFallbackEnabled: boolean;
};

export type AttendanceLifecycle = {
  // The headline state.
  state: AttendanceLifecycleState;
  // Everything wrong with the setup, most blocking first. May be non-empty even
  // when the headline is a healthy record state.
  issues: AttendanceLifecycleState[];
  // TRUE only when every prerequisite is actually satisfied. The UI must never
  // claim monitoring is on without this.
  monitoringActive: boolean;
  // The monitoring start time, when the headline is monitoring_starts_at.
  monitoringStartsAt: string | null;
  // Manual clock in/out is a FALLBACK, and is offered when it is allowed at
  // all — most usefully when the automatic path is broken.
  manualFallbackAvailable: boolean;
  // True when the automatic path cannot currently record attendance, so the UI
  // can promote the fallback instead of burying it.
  manualFallbackRecommended: boolean;
};

/**
 * The three conditions that must ALL hold before "Waiting for arrival" may be
 * shown. Anything less and the phrase would assert that the system is watching
 * when it is not.
 */
export function canShowWaitingForArrival(input: {
  monitoringActive: boolean;
  geofenceHealthy: boolean;
  onsite: boolean | null;
}): boolean {
  // `onsite === false` specifically: a null fix means we do not know where they
  // are, which is not the same as knowing they are away.
  return input.monitoringActive && input.geofenceHealthy && input.onsite === false;
}

/**
 * Every reason the automatic path cannot be trusted right now, most blocking
 * first. Empty means the pipeline is genuinely healthy.
 */
export function collectSetupIssues(input: LifecycleInput): AttendanceLifecycleState[] {
  const issues: AttendanceLifecycleState[] = [];

  if (!input.hasAssignmentToday) issues.push("no_assignment_today");
  else if (!input.jobsiteHasVerifiedCoordinates) issues.push("jobsite_missing_coordinates");

  if (input.foregroundPermission !== "granted") issues.push("permission_setup_required");
  else if (input.nativeGeofenceSupported && input.backgroundPermission === "denied") {
    // Only meaningful where background monitoring exists at all. "unknown" is
    // not reported as a problem — we would be guessing.
    issues.push("background_permission_missing");
  }

  if (input.preciseLocation === false) issues.push("precise_location_unavailable");

  // On a native runtime, background detection is the mechanism; without it the
  // employee is relying on having the app open, which they should be told.
  if (!input.nativeGeofenceSupported) issues.push("native_geofence_unavailable");
  else if (input.assignedJobGeofenceRegistered === false || input.deviceCredentialActive === false) {
    issues.push("native_geofence_unavailable");
  }

  if (input.lastSyncFailed) issues.push("last_sync_failed");
  if (input.pendingQueueCount > 0) issues.push("offline_events_pending");

  return issues;
}

// Issues that make automatic attendance impossible, as opposed to merely
// degraded. A backlog waiting to sync is not the same as no permission.
const BLOCKING_ISSUES = new Set<AttendanceLifecycleState>([
  "no_assignment_today",
  "jobsite_missing_coordinates",
  "permission_setup_required",
  "background_permission_missing",
  "precise_location_unavailable",
  "native_geofence_unavailable",
]);

export function isBlockingIssue(issue: AttendanceLifecycleState): boolean {
  return BLOCKING_ISSUES.has(issue);
}

/**
 * Derive the lifecycle state.
 *
 * Ordering:
 *  1. the company switch;
 *  2. today's RECORD — what actually happened outranks what we predict;
 *  3. blocking setup problems;
 *  4. the monitoring window;
 *  5. where the employee is.
 */
export function deriveAttendanceLifecycle(input: LifecycleInput): AttendanceLifecycle {
  const issues = collectSetupIssues(input);
  const blocking = issues.filter(isBlockingIssue);
  const geofenceHealthy = blocking.length === 0;

  // Monitoring is active ONLY when the window is open and nothing is broken.
  // This is the single guard behind "the UI never claims monitoring is active
  // when permissions, coordinates, native registration, or credentials are
  // missing".
  const monitoringActive =
    input.automaticAttendanceEnabled && geofenceHealthy && input.monitoringWindowActive === true;

  const manualFallbackAvailable = input.manualFallbackEnabled;
  const base = {
    issues,
    monitoringActive,
    monitoringStartsAt: input.monitoringStartsAt,
    manualFallbackAvailable,
    manualFallbackRecommended: !input.automaticAttendanceEnabled || blocking.length > 0,
  };

  if (!input.automaticAttendanceEnabled) {
    return { ...base, state: "automatic_attendance_disabled" };
  }

  // 2. The record. A completed or open shift is a fact; it outranks every
  //    prediction, and hiding it behind a setup warning would be misleading.
  const card = input.todayCard;
  if (card?.clockOutAt) return { ...base, state: "clocked_out_automatically" };
  if (card?.clockInAt && card.pendingDepartureAt) return { ...base, state: "departure_pending" };
  if (card?.clockInAt) return { ...base, state: "clocked_in_automatically" };
  if (card?.onsiteBeforeShiftAt) return { ...base, state: "onsite_before_shift" };

  // 3. Setup problems. One problem names itself; several mean the whole path
  //    is unreliable and the employee needs the list, not a single symptom.
  if (blocking.length === 1) return { ...base, state: blocking[0] };
  if (blocking.length > 1) return { ...base, state: "automatic_attendance_degraded" };

  // Non-blocking sync problems only surface as the headline when there is
  // nothing more important to say.
  if (input.lastSyncFailed) return { ...base, state: "last_sync_failed" };

  // 4. The monitoring window.
  if (input.monitoringWindowActive === false) {
    return { ...base, state: "monitoring_starts_at" };
  }

  if (input.pendingQueueCount > 0) return { ...base, state: "offline_events_pending" };

  // 5. Where they are. Note the deliberate asymmetry: we say "waiting for
  //    arrival" only when we can PROVE they are away.
  if (canShowWaitingForArrival({ monitoringActive, geofenceHealthy, onsite: input.onsite })) {
    return { ...base, state: "waiting_for_arrival" };
  }

  return { ...base, state: monitoringActive ? "monitoring_active" : "automatic_attendance_degraded" };
}
