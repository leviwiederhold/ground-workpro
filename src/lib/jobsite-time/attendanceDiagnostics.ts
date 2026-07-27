// Structured diagnostics for the automatic-attendance pipeline.
//
// Purpose: make it possible to determine EXACTLY why an employee shows
// "Waiting for arrival" (or why automatic attendance is inactive) — distinct
// causes for assignment, coordinates, permissions, monitoring window, geofence
// registration, and GPS. This module only INSTRUMENTS the existing pipeline; it
// does not change any attendance behavior.
//
// Privacy: the snapshot intentionally carries only a SINGLE current location fix
// (never continuous history) and never any credential/token. buildAttendance
// Diagnostics() is the one place that assembles the snapshot, so redaction is
// centralized here. Render it only in an admin/development surface.

import { feetToMeters, haversineMeters } from "./domain.ts";

// Explicit, machine-readable causes for automatic attendance being inactive.
export type AutoAttendanceInactiveReason =
  | "NO_ASSIGNMENT"
  | "JOB_MISSING_COORDINATES"
  | "OUTSIDE_MONITORING_WINDOW"
  | "LOCATION_PERMISSION_DENIED"
  | "BACKGROUND_PERMISSION_MISSING"
  | "PRECISE_LOCATION_DISABLED"
  | "GEOFENCE_NOT_REGISTERED"
  | "LOCATION_UNAVAILABLE"
  | "OUTSIDE_GEOFENCE";

export type PermissionState = "granted" | "denied" | "prompt" | "unavailable" | "unknown";

// Reject readings older than this or worse than this accuracy when deciding
// whether we have a usable fix. Kept conservative; consumers may override.
export const DEFAULT_MAX_LOCATION_ACCURACY_METERS = 100;
export const DEFAULT_MAX_LOCATION_AGE_MS = 2 * 60 * 1000; // 2 minutes

export type DiagnosticsAssignedJob = {
  jobId: string;
  name: string;
  lat: number | null;
  lng: number | null;
  addressVerified: boolean;
};

export type DiagnosticsLocationFix = {
  lat: number | null;
  lng: number | null;
  accuracyMeters: number | null;
  capturedAt: string | null; // ISO
};

export type DiagnosticsPermissions = {
  foreground: PermissionState;
  background: PermissionState;
  // null = unknown (e.g. web, or OS did not report it).
  preciseLocation: boolean | null;
  locationServicesEnabled: boolean | null;
};

// Offline-queue health, surfaced so "attendance looks stuck" can be attributed
// to un-synced events rather than guessed at.
export type AttendanceQueueHealth = {
  pendingCount: number;
  quarantinedCount: number;
  oldestOccurredAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
  nextAttemptAt: string | null;
  // Whether the durable native store is backing the queue, or localStorage is.
  durableStore: boolean;
};

export type DiagnosticsRegisteredGeofence = {
  jobId: string;
  zone: string;
  radiusMeters: number;
};

export type AttendanceDiagnosticsInput = {
  employeeId: string | null;
  assignedJob: DiagnosticsAssignedJob | null;
  // Arrival radius (small zone) in feet, and optional wide wake radius in meters.
  geofenceRadiusFeet: number | null;
  wakeRadiusMeters: number | null;
  monitoringLeadMinutes: number | null;
  schedule: { startAt: string | null; endAt: string | null } | null;
  permissions: DiagnosticsPermissions;
  location: DiagnosticsLocationFix | null;
  registeredGeofences: DiagnosticsRegisteredGeofence[];
  lastGeofenceEntryAt: string | null;
  lastGeofenceExitAt: string | null;
  lastSuccessfulSyncAt: string | null;
  // Offline attendance queue health. Omitted/null when the queue has not been
  // read (e.g. a caller that only wants the permission + geofence picture).
  queue?: AttendanceQueueHealth | null;
  attendanceStatus: string | null;
  // Whether this runtime supports native background geofencing at all. When
  // false, background-permission / geofence-registration reasons don't apply.
  nativeGeofenceSupported: boolean;
  now?: string;
  maxAccuracyMeters?: number;
  maxLocationAgeMs?: number;
};

export type AttendanceDiagnostics = {
  employeeId: string | null;
  assignedJob: DiagnosticsAssignedJob | null;
  hasUsableCoordinates: boolean;
  geofenceRadiusFeet: number | null;
  geofenceRadiusMeters: number | null;
  wakeRadiusMeters: number | null;
  monitoringLeadMinutes: number | null;
  schedule: { startAt: string | null; endAt: string | null } | null;
  monitoringWindow: { startAt: string | null; endAt: string | null; active: boolean | null };
  permissions: DiagnosticsPermissions;
  location: DiagnosticsLocationFix | null;
  locationUsable: boolean;
  locationRejectedReason: "none" | "missing" | "stale" | "inaccurate";
  distanceMeters: number | null;
  isWithinGeofence: boolean | null;
  registeredGeofences: DiagnosticsRegisteredGeofence[];
  assignedJobGeofenceRegistered: boolean | null;
  lastGeofenceEntryAt: string | null;
  lastGeofenceExitAt: string | null;
  lastSuccessfulSyncAt: string | null;
  queue: AttendanceQueueHealth | null;
  attendanceStatus: string | null;
  nativeGeofenceSupported: boolean;
  automaticAttendanceActive: boolean;
  inactiveReason: AutoAttendanceInactiveReason | null;
  capturedAt: string;
};

function toTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

function isPermissionGranted(state: PermissionState): boolean {
  return state === "granted";
}

/**
 * Compute the monitoring window [start - lead, end]. Returns active = null when
 * the schedule/lead is unknown (so "outside window" is never falsely reported).
 */
export function computeMonitoringWindow(
  schedule: { startAt: string | null; endAt: string | null } | null,
  leadMinutes: number | null,
  nowIso: string
): { startAt: string | null; endAt: string | null; active: boolean | null } {
  const start = toTime(schedule?.startAt ?? null);
  const end = toTime(schedule?.endAt ?? null);
  const lead = typeof leadMinutes === "number" && Number.isFinite(leadMinutes) ? leadMinutes : null;
  if (start === null || lead === null) {
    return { startAt: null, endAt: schedule?.endAt ?? null, active: null };
  }
  const windowStart = start - lead * 60 * 1000;
  const windowEnd = end !== null ? end : windowStart + 24 * 60 * 60 * 1000;
  const now = toTime(nowIso) ?? Date.now();
  return {
    startAt: new Date(windowStart).toISOString(),
    endAt: end !== null ? new Date(windowEnd).toISOString() : null,
    active: now >= windowStart && now <= windowEnd,
  };
}

/** Classify whether the single location fix is usable (present, fresh, accurate). */
export function classifyLocation(
  location: DiagnosticsLocationFix | null,
  nowIso: string,
  maxAccuracyMeters: number,
  maxAgeMs: number
): { usable: boolean; reason: "none" | "missing" | "stale" | "inaccurate" } {
  if (!location || location.lat === null || location.lng === null) {
    return { usable: false, reason: "missing" };
  }
  const capturedAt = toTime(location.capturedAt);
  const now = toTime(nowIso) ?? Date.now();
  if (capturedAt !== null && now - capturedAt > maxAgeMs) {
    return { usable: false, reason: "stale" };
  }
  if (
    location.accuracyMeters !== null &&
    Number.isFinite(location.accuracyMeters) &&
    location.accuracyMeters > maxAccuracyMeters
  ) {
    return { usable: false, reason: "inaccurate" };
  }
  return { usable: true, reason: "none" };
}

/**
 * Determine why automatic attendance is inactive, or null when it is active.
 * Precedence surfaces the most fundamental cause first, and keeps permission
 * problems distinguishable from assignment and GPS problems.
 */
export function evaluateAutoAttendanceInactiveReason(
  input: AttendanceDiagnosticsInput
): AutoAttendanceInactiveReason | null {
  const now = input.now ?? new Date().toISOString();

  // 1. Assignment.
  if (!input.assignedJob) return "NO_ASSIGNMENT";
  if (
    input.assignedJob.lat === null ||
    input.assignedJob.lng === null ||
    !input.assignedJob.addressVerified
  ) {
    return "JOB_MISSING_COORDINATES";
  }

  // 2. Permissions (foreground → background → precise).
  if (input.permissions.foreground === "denied") return "LOCATION_PERMISSION_DENIED";
  if (input.permissions.locationServicesEnabled === false) return "LOCATION_UNAVAILABLE";
  if (input.nativeGeofenceSupported && !isPermissionGranted(input.permissions.background)) {
    return "BACKGROUND_PERMISSION_MISSING";
  }
  if (input.permissions.preciseLocation === false) return "PRECISE_LOCATION_DISABLED";

  // 3. Monitoring window (only when we can actually compute it).
  const window = computeMonitoringWindow(input.schedule, input.monitoringLeadMinutes, now);
  if (window.active === false) return "OUTSIDE_MONITORING_WINDOW";

  // 4. Native geofence registration for the assigned job.
  if (input.nativeGeofenceSupported) {
    const registered = input.registeredGeofences.some(
      (g) => String(g.jobId) === String(input.assignedJob?.jobId)
    );
    if (!registered) return "GEOFENCE_NOT_REGISTERED";
  }

  // 5. A usable current fix.
  const maxAccuracy = input.maxAccuracyMeters ?? DEFAULT_MAX_LOCATION_ACCURACY_METERS;
  const maxAge = input.maxLocationAgeMs ?? DEFAULT_MAX_LOCATION_AGE_MS;
  const loc = classifyLocation(input.location, now, maxAccuracy, maxAge);
  if (!loc.usable) return "LOCATION_UNAVAILABLE";

  // 6. Inside the arrival geofence?
  const radiusMeters = input.geofenceRadiusFeet !== null ? feetToMeters(input.geofenceRadiusFeet) : null;
  if (radiusMeters !== null && input.location) {
    const distance = haversineMeters(
      input.assignedJob.lat,
      input.assignedJob.lng,
      input.location.lat as number,
      input.location.lng as number
    );
    if (distance > radiusMeters) return "OUTSIDE_GEOFENCE";
  }

  return null;
}

/** Assemble the full, redacted diagnostics snapshot. */
export function buildAttendanceDiagnostics(
  input: AttendanceDiagnosticsInput
): AttendanceDiagnostics {
  const now = input.now ?? new Date().toISOString();
  const maxAccuracy = input.maxAccuracyMeters ?? DEFAULT_MAX_LOCATION_ACCURACY_METERS;
  const maxAge = input.maxLocationAgeMs ?? DEFAULT_MAX_LOCATION_AGE_MS;

  const hasUsableCoordinates = Boolean(
    input.assignedJob &&
      input.assignedJob.lat !== null &&
      input.assignedJob.lng !== null &&
      input.assignedJob.addressVerified
  );

  const window = computeMonitoringWindow(input.schedule, input.monitoringLeadMinutes, now);
  const loc = classifyLocation(input.location, now, maxAccuracy, maxAge);

  const radiusMeters = input.geofenceRadiusFeet !== null ? feetToMeters(input.geofenceRadiusFeet) : null;
  let distanceMeters: number | null = null;
  let isWithin: boolean | null = null;
  if (hasUsableCoordinates && loc.usable && input.location) {
    distanceMeters = haversineMeters(
      input.assignedJob!.lat as number,
      input.assignedJob!.lng as number,
      input.location.lat as number,
      input.location.lng as number
    );
    if (radiusMeters !== null) isWithin = distanceMeters <= radiusMeters;
  }

  const assignedJobGeofenceRegistered = input.assignedJob
    ? input.registeredGeofences.some((g) => String(g.jobId) === String(input.assignedJob?.jobId))
    : null;

  const inactiveReason = evaluateAutoAttendanceInactiveReason(input);

  return {
    employeeId: input.employeeId,
    assignedJob: input.assignedJob,
    hasUsableCoordinates,
    geofenceRadiusFeet: input.geofenceRadiusFeet,
    geofenceRadiusMeters: radiusMeters,
    wakeRadiusMeters: input.wakeRadiusMeters,
    monitoringLeadMinutes: input.monitoringLeadMinutes,
    schedule: input.schedule,
    monitoringWindow: window,
    permissions: input.permissions,
    location: input.location,
    locationUsable: loc.usable,
    locationRejectedReason: loc.reason,
    distanceMeters,
    isWithinGeofence: isWithin,
    registeredGeofences: input.registeredGeofences,
    assignedJobGeofenceRegistered,
    lastGeofenceEntryAt: input.lastGeofenceEntryAt,
    lastGeofenceExitAt: input.lastGeofenceExitAt,
    lastSuccessfulSyncAt: input.queue?.lastSuccessfulSyncAt ?? input.lastSuccessfulSyncAt,
    queue: input.queue ?? null,
    attendanceStatus: input.attendanceStatus,
    nativeGeofenceSupported: input.nativeGeofenceSupported,
    automaticAttendanceActive: inactiveReason === null,
    inactiveReason,
    capturedAt: now,
  };
}

// Human-readable, developer-facing explanations for each reason code.
export const AUTO_ATTENDANCE_INACTIVE_REASON_LABEL: Record<AutoAttendanceInactiveReason, string> = {
  NO_ASSIGNMENT: "No job is assigned to this employee today.",
  JOB_MISSING_COORDINATES: "The assigned job has no verified latitude/longitude.",
  OUTSIDE_MONITORING_WINDOW: "The current time is outside the monitoring window.",
  LOCATION_PERMISSION_DENIED: "Foreground location permission is denied.",
  BACKGROUND_PERMISSION_MISSING: "Background (Always) location permission is not granted.",
  PRECISE_LOCATION_DISABLED: "Precise location is turned off.",
  GEOFENCE_NOT_REGISTERED: "No native geofence is registered for the assigned job.",
  LOCATION_UNAVAILABLE: "No usable current location fix (missing, stale, or inaccurate).",
  OUTSIDE_GEOFENCE: "The employee is outside the jobsite arrival radius.",
};
