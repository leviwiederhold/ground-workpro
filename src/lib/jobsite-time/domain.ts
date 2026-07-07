/* eslint-disable @typescript-eslint/no-explicit-any */
// Shared domain logic for Attendance (two-zone jobsite geofencing). Pure/functional
// so it can be unit-reasoned and reused by the API routes and the UI.

export const TIMECARD_STATUSES = [
  "active",
  "pending_review",
  "approved",
  "rejected",
  "needs_review",
] as const;
export type TimecardStatus = (typeof TIMECARD_STATUSES)[number];

export const TIMECARD_SOURCES = ["manual", "jobsite_auto", "manager_adjusted"] as const;
export type TimecardSource = (typeof TIMECARD_SOURCES)[number];

export const TIMECARD_CONFIDENCE = ["high", "medium", "low"] as const;
export type TimecardConfidence = (typeof TIMECARD_CONFIDENCE)[number];

export const TIMECARD_EVENT_TYPES = [
  "entered_geofence",
  "exited_geofence",
  "auto_clock_in",
  "auto_clock_out",
  "break_suggested",
  "manager_edited",
  "approved",
  "rejected",
] as const;
export type TimecardEventType = (typeof TIMECARD_EVENT_TYPES)[number];

// The two zones a job's geofence is evaluated against. "wake" is a wide radius
// that only starts closer monitoring; "arrival" is the small radius that is the
// actual attendance event (see two-zone model below).
export const GEOFENCE_ZONES = ["wake", "arrival"] as const;
export type GeofenceZone = (typeof GEOFENCE_ZONES)[number];

// Roles allowed to view/manage ALL company timecards. Everyone else is scoped
// to their own records (or blocked).
export function canManageTimecards(role: string | null | undefined): boolean {
  const r = String(role ?? "").toLowerCase();
  return r === "admin" || r === "pm" || r === "executive" || r === "ceo" || r === "operations" || r === "manager";
}

export function feetToMeters(feet: number): number {
  return feet * 0.3048;
}

export function metersToMiles(meters: number): number {
  return meters / 1609.34;
}

// Great-circle distance in meters between two lat/lng points.
export function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isWithinGeofence(params: {
  jobLat: number;
  jobLng: number;
  pointLat: number;
  pointLng: number;
  radiusFeet: number;
}): boolean {
  const meters = haversineMeters(params.jobLat, params.jobLng, params.pointLat, params.pointLng);
  return meters <= feetToMeters(params.radiusFeet);
}

// GPS accuracy → confidence. Poor accuracy (or a fix that could place the
// employee outside the fence) must be flagged for manager review.
export function confidenceForAccuracy(accuracyMeters: number | null | undefined): TimecardConfidence {
  const a = Number(accuracyMeters ?? NaN);
  if (!Number.isFinite(a)) return "low";
  if (a <= 25) return "high";
  if (a <= 75) return "medium";
  return "low";
}

// Total worked minutes from clock in/out minus a single break window. Never
// negative; returns 0 until both clock in and out exist.
export function computeTotalMinutes(row: {
  clock_in_at?: string | null;
  clock_out_at?: string | null;
  break_start_at?: string | null;
  break_end_at?: string | null;
}): number {
  const inMs = row.clock_in_at ? Date.parse(row.clock_in_at) : NaN;
  const outMs = row.clock_out_at ? Date.parse(row.clock_out_at) : NaN;
  if (!Number.isFinite(inMs) || !Number.isFinite(outMs) || outMs <= inMs) return 0;
  let minutes = (outMs - inMs) / 60000;
  const bStart = row.break_start_at ? Date.parse(row.break_start_at) : NaN;
  const bEnd = row.break_end_at ? Date.parse(row.break_end_at) : NaN;
  if (Number.isFinite(bStart) && Number.isFinite(bEnd) && bEnd > bStart) {
    minutes -= (bEnd - bStart) / 60000;
  }
  return Math.max(0, Math.round(minutes));
}

// Server-side verification of a native enter/exit event for the ARRIVAL zone.
// We do NOT fully trust the native transition: we recompute distance from the
// job's saved coordinates and the submitted point, cross-check the configured
// arrival radius (with a GPS-accuracy slack), and enforce the scheduled window.
// Poor accuracy, questionable distance, missing coordinates, or off-window
// events downgrade confidence and force manager review; only grossly-off-location
// "enter" events are hard-rejected.
export type JobsiteEvaluation = {
  reject: boolean;
  reason?: string;
  confidence: TimecardConfidence;
  needsReview: boolean;
  distanceMeters: number | null;
  withinSchedule: boolean | null;
};

const CONF_RANK: Record<TimecardConfidence, number> = { low: 0, medium: 1, high: 2 };

export function evaluateJobsiteEvent(params: {
  transition: "enter" | "exit";
  occurredAt: string;
  jobLat: number | null | undefined;
  jobLng: number | null | undefined;
  pointLat: number | null | undefined;
  pointLng: number | null | undefined;
  accuracyMeters: number | null | undefined;
  radiusFeet: number;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  hasSchedule: boolean;
}): JobsiteEvaluation {
  let confidence: TimecardConfidence = confidenceForAccuracy(params.accuracyMeters);
  let needsReview = false;
  const downgrade = (c: TimecardConfidence) => {
    if (CONF_RANK[c] < CONF_RANK[confidence]) confidence = c;
  };

  // --- Geofence verification -------------------------------------------------
  let distanceMeters: number | null = null;
  const radiusM = feetToMeters(params.radiusFeet);
  const jobLat = Number(params.jobLat);
  const jobLng = Number(params.jobLng);
  const ptLat = Number(params.pointLat);
  const ptLng = Number(params.pointLng);
  const hasJobCoords = Number.isFinite(jobLat) && Number.isFinite(jobLng);
  const hasPointCoords = Number.isFinite(ptLat) && Number.isFinite(ptLng);
  const accuracyM = Number.isFinite(Number(params.accuracyMeters)) ? Number(params.accuracyMeters) : null;

  if (hasJobCoords && hasPointCoords) {
    distanceMeters = haversineMeters(jobLat, jobLng, ptLat, ptLng);
    const slack = Math.max(accuracyM ?? 0, 30);
    if (params.transition === "enter") {
      if (distanceMeters > radiusM + slack * 3 && distanceMeters > radiusM * 2) {
        // Grossly outside the fence on an arrival — obviously invalid.
        return {
          reject: true,
          reason: "Event location is not near the jobsite",
          confidence: "low",
          needsReview: true,
          distanceMeters,
          withinSchedule: null,
        };
      }
      if (distanceMeters > radiusM) {
        downgrade("low");
        needsReview = true; // inside slack but past the radius — questionable
      }
    } else {
      // exit: should be outside. Still inside → questionable departure.
      if (distanceMeters <= radiusM) {
        downgrade(distanceMeters < radiusM * 0.5 ? "low" : "medium");
        needsReview = true;
      }
    }
  } else {
    // No coordinates to verify against → cannot confirm the jobsite match.
    downgrade("low");
    needsReview = true;
  }

  // --- Scheduled window enforcement -----------------------------------------
  let withinSchedule: boolean | null = null;
  const t = Date.parse(params.occurredAt);
  const graceMs = 30 * 60000;
  if (params.hasSchedule && params.scheduledStart && params.scheduledEnd) {
    const s = Date.parse(params.scheduledStart);
    const e = Date.parse(params.scheduledEnd);
    withinSchedule = Number.isFinite(s) && Number.isFinite(e) && t >= s - graceMs && t <= e + graceMs;
    if (!withinSchedule) {
      downgrade("low");
      needsReview = true; // outside the assigned shift window
    }
  } else {
    // No assigned shift window yet → conservative fallback: at most medium and
    // always manager review. Off-hours (weekend / overnight) without a shift is
    // downgraded further so nights/weekends are never silently trusted.
    withinSchedule = null;
    downgrade("medium");
    needsReview = true;
    const d = new Date(t);
    const day = d.getUTCDay();
    const hour = d.getUTCHours();
    if (day === 0 || day === 6 || hour >= 21 || hour < 5) downgrade("low");
  }

  return { reject: false, confidence, needsReview, distanceMeters, withinSchedule };
}

export function mapTimecard(row: any) {
  return {
    id: row.id,
    companyId: row.company_id ?? null,
    employeeId: row.employee_id ?? null,
    userId: row.user_id ?? null,
    jobId: row.job_id ?? null,
    assignmentId: row.assignment_id ?? null,
    workDate: row.work_date ?? null,
    scheduledStart: row.scheduled_start ?? null,
    scheduledEnd: row.scheduled_end ?? null,
    geofenceRadiusFeet: row.geofence_radius_feet ?? null,
    detectedArrivalAt: row.detected_arrival_at ?? null,
    detectedDepartureAt: row.detected_departure_at ?? null,
    pendingArrivalAt: row.pending_arrival_at ?? null,
    pendingDepartureAt: row.pending_departure_at ?? null,
    clockInAt: row.clock_in_at ?? null,
    clockOutAt: row.clock_out_at ?? null,
    breakStartAt: row.break_start_at ?? null,
    breakEndAt: row.break_end_at ?? null,
    totalMinutes: Number(row.total_minutes ?? 0),
    status: (row.status ?? "active") as TimecardStatus,
    source: (row.source ?? "jobsite_auto") as TimecardSource,
    confidence: (row.confidence ?? "high") as TimecardConfidence,
    notes: row.notes ?? "",
    approvedBy: row.approved_by ?? null,
    approvedAt: row.approved_at ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

export function mapTimecardEvent(row: any) {
  return {
    id: row.id,
    timecardId: row.timecard_id ?? null,
    eventType: row.event_type as TimecardEventType,
    occurredAt: row.occurred_at ?? null,
    jobId: row.job_id ?? null,
    employeeId: row.employee_id ?? null,
    userId: row.user_id ?? null,
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    accuracyMeters: row.accuracy_meters ?? null,
    source: (row.source ?? "jobsite_auto") as TimecardSource,
    notes: row.notes ?? "",
    createdAt: row.created_at ?? null,
  };
}

export type JobsiteTimeSettings = {
  enabled: boolean;
  requireApproval: boolean;
  // Wake zone: wide radius that only wakes closer monitoring — never marks an
  // arrival by itself.
  wakeRadiusMeters: number;
  // Arrival zone: small radius that is the actual attendance (clock-in/out) event.
  arrivalRadiusFeet: number;
  // How long an employee must stay outside the arrival radius before a
  // departure is confirmed (avoids clocking someone out for a brief dip out of
  // range).
  departureGraceMinutes: number;
  // How long an employee must stay inside the arrival radius before an arrival
  // is confirmed (avoids clocking someone in for briefly driving past).
  arrivalConfirmationSeconds: number;
  manualFallbackEnabled: boolean;
};

// ~1 mile. Wakes the app / starts closer monitoring — does not mark arrival.
export const DEFAULT_WAKE_RADIUS_METERS = 1609;
// ~500 ft. The actual attendance (arrival/departure) event radius.
export const DEFAULT_ARRIVAL_RADIUS_FEET = 500;
export const DEFAULT_DEPARTURE_GRACE_MINUTES = 5;
export const DEFAULT_ARRIVAL_CONFIRMATION_SECONDS = 45;

export const DEFAULT_JOBSITE_TIME_SETTINGS: JobsiteTimeSettings = {
  enabled: false,
  requireApproval: true,
  wakeRadiusMeters: DEFAULT_WAKE_RADIUS_METERS,
  arrivalRadiusFeet: DEFAULT_ARRIVAL_RADIUS_FEET,
  departureGraceMinutes: DEFAULT_DEPARTURE_GRACE_MINUTES,
  arrivalConfirmationSeconds: DEFAULT_ARRIVAL_CONFIRMATION_SECONDS,
  manualFallbackEnabled: true,
};

// Wake radius options, labeled in miles for the UI.
export const ALLOWED_WAKE_RADII_METERS = [805, 1609, 3219] as const; // 0.5, 1, 2 miles

// Arrival radius options, labeled in feet for the UI.
export const ALLOWED_ARRIVAL_RADII_FEET = [150, 250, 500, 1000] as const;

// Departure grace period options, in minutes (3–5 min per product spec).
export const ALLOWED_DEPARTURE_GRACE_MINUTES = [3, 4, 5] as const;

// Arrival confirmation delay options, in seconds (30–60 sec per product spec).
export const ALLOWED_ARRIVAL_CONFIRMATION_SECONDS = [30, 45, 60] as const;

export function wakeRadiusLabel(meters: number): string {
  const miles = Math.round(metersToMiles(meters) * 100) / 100;
  return `${miles} mile${miles === 1 ? "" : "s"}`;
}

export function arrivalRadiusLabel(feet: number): string {
  if (feet >= 1000) return `${(feet / 1000).toFixed(feet % 1000 === 0 ? 0 : 1)}k ft`;
  return `${feet} ft`;
}

export function departureGraceLabel(minutes: number): string {
  return `${minutes} min`;
}

export function arrivalConfirmationLabel(seconds: number): string {
  return `${seconds} sec`;
}

export function mapCompanyJobsiteSettings(row: any): JobsiteTimeSettings {
  return {
    enabled: Boolean(row?.jobsite_time_enabled),
    requireApproval: row?.jobsite_require_approval ?? true,
    wakeRadiusMeters: Number(row?.jobsite_wake_radius_meters ?? DEFAULT_WAKE_RADIUS_METERS),
    // Preserve any saved radius; only fall back to the 500 ft default when unset.
    arrivalRadiusFeet: Number(row?.jobsite_geofence_radius_feet ?? DEFAULT_ARRIVAL_RADIUS_FEET),
    departureGraceMinutes: Number(row?.jobsite_departure_grace_minutes ?? DEFAULT_DEPARTURE_GRACE_MINUTES),
    arrivalConfirmationSeconds: Number(
      row?.jobsite_arrival_confirmation_seconds ?? DEFAULT_ARRIVAL_CONFIRMATION_SECONDS
    ),
    manualFallbackEnabled: row?.jobsite_manual_fallback_enabled ?? true,
  };
}

export const JOBSITE_TIME_PRIVACY_COPY =
  "Location is only used during assigned shifts to verify arrival and departure from the jobsite. Groundwork Pro does not track your location outside work, and never stores your travel path.";

// ---------------------------------------------------------------------------
// Employee-facing display status. Kept deliberately non-technical: no mention
// of confidence, source, geofence, or event ingestion.
// ---------------------------------------------------------------------------
export const ATTENDANCE_DISPLAY_STATUSES = [
  "no_job",
  "address_needs_verification",
  "waiting",
  "checked_in",
  "checked_out",
  "needs_review",
  "missing_clock_out",
] as const;
export type AttendanceDisplayStatus = (typeof ATTENDANCE_DISPLAY_STATUSES)[number];

export const ATTENDANCE_STATUS_LABEL: Record<AttendanceDisplayStatus, string> = {
  no_job: "No assigned job",
  address_needs_verification: "Address needs verification",
  waiting: "Waiting for arrival",
  checked_in: "Checked in",
  checked_out: "Checked out",
  needs_review: "Needs review",
  missing_clock_out: "Missing clock-out",
};

// Derives the simple, employee/manager-facing status from a timecard + the
// assigned job's verification state. Shared by the manager roster and the
// employee status card so both always agree.
export function deriveAttendanceStatus(params: {
  hasAssignedJob: boolean;
  assignedJobAddressVerified: boolean;
  todayCard: { clockInAt: string | null; clockOutAt: string | null; status: string } | null;
  hasStaleOpenCard: boolean;
}): AttendanceDisplayStatus {
  if (!params.hasAssignedJob) return "no_job";
  if (!params.assignedJobAddressVerified) return "address_needs_verification";
  if (params.hasStaleOpenCard) return "missing_clock_out";
  const t = params.todayCard;
  if (!t) return "waiting";
  // "needs_review" is a genuine anomaly (bad GPS, off-schedule, unmatched
  // location) — distinct from "pending_review", which is just the routine
  // awaiting-manager-approval state every auto-tracked entry starts in when
  // approval is required. Only the former should pull someone out of the
  // normal On Site / Not Arrived / Recently Left roster view.
  if (t.status === "needs_review") return "needs_review";
  if (t.clockOutAt) return "checked_out";
  if (t.clockInAt) return "checked_in";
  return "waiting";
}

// ---------------------------------------------------------------------------
// Nearest assigned-job matching (section 4: assigned jobs only, closest job
// wins when several are in range). Shared by the server event evaluator and
// the foreground client geofence fallback.
// ---------------------------------------------------------------------------
export type AssignedJobLocation = {
  jobId: string;
  lat: number | null;
  lng: number | null;
  addressVerified: boolean;
};

export function pickNearestAssignedJob(
  jobs: AssignedJobLocation[],
  point: { lat: number; lng: number }
): { job: AssignedJobLocation; distanceMeters: number } | null {
  let best: { job: AssignedJobLocation; distanceMeters: number } | null = null;
  for (const job of jobs) {
    if (!job.addressVerified || job.lat === null || job.lng === null) continue;
    const distanceMeters = haversineMeters(job.lat, job.lng, point.lat, point.lng);
    if (!best || distanceMeters < best.distanceMeters) {
      best = { job, distanceMeters };
    }
  }
  return best;
}
