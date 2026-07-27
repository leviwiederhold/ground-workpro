// Foreground attendance reconciliation (basic correctness layer).
//
// Given today's assignment, a single fresh location fix, the schedule, and the
// existing attendance record, decide the correct attendance state and whether a
// clock-in must be created/repaired. This is the foreground fallback that fixes
// "opened the app onsite but it still said Waiting for arrival" — it is NOT the
// full background solution.
//
// Pure and side-effect free so the distance/onsite decisions are unit-tested.
//
// KNOWN DUPLICATION (deliberate, not yet resolved): the AttendanceStatus values
// and the onsite / before-shift / early-arrival rules below are a second
// evaluation of "should this person be clocked in", alongside
// decideArrivalClockIn() in ../attendance/scheduledClockIn.ts. This module does
// not write — it returns `shouldCreateClockIn` and the caller posts to
// /api/jobsite-time/events, so every actual record still goes through the one
// decision layer. The risk is drift between the two rule sets, not a second
// write path. Merging them is tracked separately; do not add new rules here
// without making the same change in decideArrivalClockIn().

import { feetToMeters, haversineMeters } from "./domain.ts";
import {
  classifyLocation,
  computeMonitoringWindow,
  DEFAULT_MAX_LOCATION_ACCURACY_METERS,
  DEFAULT_MAX_LOCATION_AGE_MS,
  type DiagnosticsLocationFix,
} from "./attendanceDiagnostics.ts";

export type AttendanceStatus =
  | "automatic_attendance_inactive"
  | "waiting_for_monitoring_window"
  | "waiting_for_arrival"
  | "onsite_before_shift"
  | "clocked_in"
  | "departure_pending"
  | "clocked_out";

// Early-arrival behavior from company attendance settings: clock in immediately
// on a confirmed onsite arrival, or hold the clock-in until scheduled start.
export type EarlyArrivalMode = "clock_in_on_arrival" | "scheduled_start";

export type ReconcileAssignedJob = {
  jobId: string;
  lat: number | null;
  lng: number | null;
  addressVerified: boolean;
};

export type ReconcileInput = {
  assignedJob: ReconcileAssignedJob | null;
  arrivalRadiusFeet: number | null;
  location: DiagnosticsLocationFix | null;
  schedule: { startAt: string | null; endAt: string | null } | null;
  monitoringLeadMinutes: number | null;
  todayCard: { clockInAt: string | null; clockOutAt: string | null; status: string } | null;
  // Company early-arrival behavior. Defaults to "scheduled_start" (hold the
  // clock-in until shift start) when unspecified.
  earlyArrivalMode?: EarlyArrivalMode;
  now?: string;
  maxAccuracyMeters?: number;
  maxLocationAgeMs?: number;
};

export type ReconcileResult = {
  status: AttendanceStatus;
  // true = inside arrival radius; false = outside; null = cannot determine.
  onsite: boolean | null;
  distanceMeters: number | null;
  // The reconciliation action: create/repair a clock-in via the events pipeline.
  shouldCreateClockIn: boolean;
  // A genuine configuration error to surface instead of "waiting_for_arrival".
  errorReason: "JOB_MISSING_COORDINATES" | null;
};

function toTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/**
 * Distance from a fresh fix to the jobsite, and whether that puts the employee
 * inside the arrival radius. Returns null when either the coordinates or the fix
 * are missing.
 */
export function computeOnsite(
  job: ReconcileAssignedJob | null,
  location: DiagnosticsLocationFix | null,
  arrivalRadiusFeet: number | null
): { distanceMeters: number | null; onsite: boolean | null } {
  if (!job || job.lat === null || job.lng === null || !job.addressVerified) {
    return { distanceMeters: null, onsite: null };
  }
  if (!location || location.lat === null || location.lng === null) {
    return { distanceMeters: null, onsite: null };
  }
  const distanceMeters = haversineMeters(job.lat, job.lng, location.lat, location.lng);
  if (arrivalRadiusFeet === null) return { distanceMeters, onsite: null };
  return { distanceMeters, onsite: distanceMeters <= feetToMeters(arrivalRadiusFeet) };
}

/**
 * Reconcile the attendance state from current signals. The key correctness
 * guarantees, matching the acceptance criteria:
 *  - inside the geofence never resolves to "waiting_for_arrival";
 *  - before shift start (but onsite) resolves to "onsite_before_shift";
 *  - after shift start (onsite, no open card) requests a clock-in repair;
 *  - missing coordinates surface a real error, not "waiting_for_arrival".
 */
export function reconcileAttendanceState(input: ReconcileInput): ReconcileResult {
  const now = input.now ?? new Date().toISOString();
  const none: Omit<ReconcileResult, "status"> = {
    onsite: null,
    distanceMeters: null,
    shouldCreateClockIn: false,
    errorReason: null,
  };

  if (!input.assignedJob) {
    return { status: "automatic_attendance_inactive", ...none };
  }

  // Missing/unverified coordinates is a real configuration error — surface it
  // rather than letting the employee sit on "waiting_for_arrival" forever.
  if (
    input.assignedJob.lat === null ||
    input.assignedJob.lng === null ||
    !input.assignedJob.addressVerified
  ) {
    return { status: "automatic_attendance_inactive", ...none, errorReason: "JOB_MISSING_COORDINATES" };
  }

  const { distanceMeters, onsite } = computeOnsite(
    input.assignedJob,
    input.location,
    input.arrivalRadiusFeet
  );

  // Existing record wins for terminal/open states.
  const card = input.todayCard;
  if (card?.clockOutAt) {
    return { status: "clocked_out", onsite, distanceMeters, shouldCreateClockIn: false, errorReason: null };
  }
  if (card?.clockInAt) {
    // Open clock-in: still on shift. If a good fix now places them clearly
    // outside, flag a pending departure (server enforces the grace period).
    const status: AttendanceStatus = onsite === false ? "departure_pending" : "clocked_in";
    return { status, onsite, distanceMeters, shouldCreateClockIn: false, errorReason: null };
  }

  // No open record yet — decide from location + schedule.
  const usable = classifyLocation(
    input.location,
    now,
    input.maxAccuracyMeters ?? DEFAULT_MAX_LOCATION_ACCURACY_METERS,
    input.maxLocationAgeMs ?? DEFAULT_MAX_LOCATION_AGE_MS
  ).usable;

  const window = computeMonitoringWindow(input.schedule, input.monitoringLeadMinutes, now);
  const nowMs = toTime(now) ?? Date.now();
  const shiftStart = toTime(input.schedule?.startAt ?? null);
  const beforeShift = shiftStart !== null && nowMs < shiftStart;

  if (onsite === true && usable) {
    if (window.active === false) {
      // Onsite but the monitoring window hasn't opened yet.
      return { status: "waiting_for_monitoring_window", onsite, distanceMeters, shouldCreateClockIn: false, errorReason: null };
    }
    if (beforeShift) {
      // Early-arrival behavior is company-configurable: either clock in on the
      // confirmed arrival, or hold the clock-in until scheduled start.
      if ((input.earlyArrivalMode ?? "scheduled_start") === "clock_in_on_arrival") {
        return { status: "clocked_in", onsite, distanceMeters, shouldCreateClockIn: true, errorReason: null };
      }
      return { status: "onsite_before_shift", onsite, distanceMeters, shouldCreateClockIn: false, errorReason: null };
    }
    // Onsite, in-window, at/after shift start, but no record → repair it.
    return { status: "clocked_in", onsite, distanceMeters, shouldCreateClockIn: true, errorReason: null };
  }

  // Not onsite (or no usable fix to prove it).
  if (window.active === false) {
    return { status: "waiting_for_monitoring_window", onsite, distanceMeters, shouldCreateClockIn: false, errorReason: null };
  }
  return { status: "waiting_for_arrival", onsite, distanceMeters, shouldCreateClockIn: false, errorReason: null };
}
