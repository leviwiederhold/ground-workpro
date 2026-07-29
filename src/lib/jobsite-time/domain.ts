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

export const ATTENDANCE_ARRIVAL_STATUSES = ["early", "on_time", "late"] as const;
export type AttendanceArrivalStatus = (typeof ATTENDANCE_ARRIVAL_STATUSES)[number];

export const DEFAULT_COMPANY_TIMEZONE = "America/New_York";
export const DEFAULT_WORK_DAYS = ["mon", "tue", "wed", "thu", "fri"] as const;
export const DEFAULT_WORK_START_TIME = "07:00";
export const DEFAULT_WORK_END_TIME = "16:00";
export const DEFAULT_EARLY_ARRIVAL_WINDOW_MINUTES = 120;
export const DEFAULT_LATE_GRACE_MINUTES = 10;

export const TIMECARD_EVENT_TYPES = [
  "entered_geofence",
  "exited_geofence",
  "auto_clock_in",
  "auto_clock_out",
  "break_suggested",
  "manager_edited",
  "approved",
  "rejected",
  // Automatic arrival / scheduled clock-in audit trail.
  "onsite_before_shift",
  "scheduled_clock_in",
  "clock_in_backfilled",
  "clock_in_rejected",
  "duplicate_suppressed",
  // Automatic departure / clock-out audit trail.
  "departure_pending",
  "departure_cancelled",
  "fallback_clock_out",
  "clock_out_rejected",
  "monitoring_stopped",
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
  return r === "admin" || r === "executive" || r === "ceo" || r === "owner";
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
  ignore?: boolean;
  reason?: string;
  confidence: TimecardConfidence;
  needsReview: boolean;
  distanceMeters: number | null;
  withinSchedule: boolean | null;
  arrivalStatus: AttendanceArrivalStatus | null;
};

export type CompanyWorkScheduleSettings = {
  timezone: string;
  workDays: string[];
  workStartTime: string;
  workEndTime: string;
  earlyArrivalWindowMinutes: number;
  lateGraceMinutes: number;
};

export type AttendanceScheduleWindow = {
  workDate: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  hasSchedule: boolean;
  isWorkDay: boolean;
};

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function safeTimezone(value: unknown): string {
  const timezone = String(value ?? "").trim() || DEFAULT_COMPANY_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return DEFAULT_COMPANY_TIMEZONE;
  }
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function normalizeWorkTime(value: unknown, fallback: string): string {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return fallback;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function normalizeWorkDays(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const normalized = raw
    .map((day) => String(day).trim().toLowerCase().slice(0, 3))
    .filter((day): day is (typeof DAY_KEYS)[number] => DAY_KEYS.includes(day as any));
  return normalized.length > 0 ? Array.from(new Set(normalized)) : [...DEFAULT_WORK_DAYS];
}

// NOTE: The canonical, no-defaults-invented loader lives in
// src/lib/company/companyConfig.ts (resolveCompanyWorkSchedule). This module
// intentionally does NOT provide a lenient "always returns a value" mapper, so
// attendance can never compute status against fabricated work hours.

function localParts(date: Date, timezone: string) {
  const timeZone = safeTimezone(timezone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
    minute: get("minute"),
    second: get("second"),
    weekday: get("weekday").toLowerCase().slice(0, 3),
  };
}

export function getCompanyLocalDateKey(iso: string, timezone: string): string {
  const date = new Date(iso);
  const parts = localParts(date, safeTimezone(timezone));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function zonedTimeToUtcIso(dateKey: string, time: string, timezone: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = normalizeWorkTime(time, DEFAULT_WORK_START_TIME).split(":").map(Number);
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 3; i += 1) {
    const parts = localParts(new Date(utcMs), safeTimezone(timezone));
    const renderedMs = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second)
    );
    const targetMs = Date.UTC(year, month - 1, day, hour, minute, 0);
    utcMs += targetMs - renderedMs;
  }
  return new Date(utcMs).toISOString();
}

export function buildCompanyScheduleWindow(
  occurredAt: string,
  settings: CompanyWorkScheduleSettings
): AttendanceScheduleWindow {
  const timezone = safeTimezone(settings.timezone);
  const workDate = getCompanyLocalDateKey(occurredAt, timezone);
  const weekday = localParts(new Date(occurredAt), timezone).weekday;
  const isWorkDay = settings.workDays.includes(weekday);
  if (!isWorkDay) {
    return { workDate, scheduledStart: null, scheduledEnd: null, hasSchedule: false, isWorkDay };
  }
  const scheduledStart = zonedTimeToUtcIso(workDate, settings.workStartTime, timezone);
  let scheduledEnd = zonedTimeToUtcIso(workDate, settings.workEndTime, timezone);
  if (Date.parse(scheduledEnd) <= Date.parse(scheduledStart)) {
    scheduledEnd = new Date(Date.parse(scheduledEnd) + 24 * 60 * 60000).toISOString();
  }
  return { workDate, scheduledStart, scheduledEnd, hasSchedule: true, isWorkDay };
}

/**
 * Scheduled start/end for a specific company-local work date (YYYY-MM-DD).
 *
 * buildCompanyScheduleWindow() derives the work date from an event timestamp;
 * the scheduled process works the other way round — it already knows the work
 * date of a stored timecard and needs the shift boundaries for it. Resolving
 * the local wall-clock time to UTC per date is what makes daylight-saving
 * transitions correct: 07:00 local is a different UTC instant on either side of
 * the change, and both are computed from the same configured "07:00".
 */
export function scheduledWindowForWorkDate(
  workDate: string,
  settings: CompanyWorkScheduleSettings
): { scheduledStart: string | null; scheduledEnd: string | null; isWorkDay: boolean } {
  const timezone = safeTimezone(settings.timezone);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(workDate ?? ""))) {
    return { scheduledStart: null, scheduledEnd: null, isWorkDay: false };
  }
  const scheduledStart = zonedTimeToUtcIso(workDate, settings.workStartTime, timezone);
  // Weekday is read back from the resolved instant so it reflects the company's
  // timezone rather than the server's.
  const weekday = localParts(new Date(scheduledStart), timezone).weekday;
  if (!settings.workDays.includes(weekday)) {
    return { scheduledStart: null, scheduledEnd: null, isWorkDay: false };
  }
  let scheduledEnd = zonedTimeToUtcIso(workDate, settings.workEndTime, timezone);
  if (Date.parse(scheduledEnd) <= Date.parse(scheduledStart)) {
    scheduledEnd = new Date(Date.parse(scheduledEnd) + 24 * 60 * 60000).toISOString();
  }
  return { scheduledStart, scheduledEnd, isWorkDay: true };
}

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
  earlyArrivalWindowMinutes?: number;
  lateGraceMinutes?: number;
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
          arrivalStatus: null,
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
  let arrivalStatus: AttendanceArrivalStatus | null = null;
  const t = Date.parse(params.occurredAt);
  // Arrival status (early/on_time/late) and the early-arrival "ignore" window
  // are ONLY computed when the caller passes company work-schedule tuning
  // (i.e. the company has valid, configured work hours + timezone). Without it
  // we never invent a status — see req: "Do not calculate late/early attendance
  // status until valid work hours and timezone exist."
  const hasCompanySchedule =
    params.earlyArrivalWindowMinutes != null && params.lateGraceMinutes != null;
  const earlyMs = clampInt(params.earlyArrivalWindowMinutes, DEFAULT_EARLY_ARRIVAL_WINDOW_MINUTES, 0, 720) * 60000;
  const graceMs = clampInt(params.lateGraceMinutes, DEFAULT_LATE_GRACE_MINUTES, 0, 240) * 60000;
  if (params.hasSchedule && params.scheduledStart && params.scheduledEnd) {
    const s = Date.parse(params.scheduledStart);
    const e = Date.parse(params.scheduledEnd);
    if (hasCompanySchedule && params.transition === "enter" && Number.isFinite(s) && t < s - earlyMs) {
      return {
        reject: false,
        ignore: true,
        reason: "Arrival is before the company's early arrival tracking window",
        confidence,
        needsReview: false,
        distanceMeters,
        withinSchedule: false,
        arrivalStatus: null,
      };
    }
    withinSchedule = Number.isFinite(s) && Number.isFinite(e) && t >= s - earlyMs && t <= e + graceMs;
    if (hasCompanySchedule && params.transition === "enter" && Number.isFinite(s)) {
      if (t < s) arrivalStatus = "early";
      else if (t <= s + graceMs) arrivalStatus = "on_time";
      else arrivalStatus = "late";
    }
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

  return { reject: false, confidence, needsReview, distanceMeters, withinSchedule, arrivalStatus };
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
    arrivalStatus: row.arrival_status ?? null,
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
    // Precise provenance: which mechanism produced this event, when the DEVICE
    // said it happened, and when the SERVER received it. The gap between the
    // last two is the offline-queue delay, and it must stay visible.
    eventSource: row.event_source ?? null,
    deviceReportedAt: row.device_reported_at ?? null,
    serverReceivedAt: row.server_received_at ?? row.created_at ?? null,
    validationResult: row.validation_result ?? null,
    validationReason: row.validation_reason ?? null,
    correctionId: row.correction_id ?? null,
    notes: row.notes ?? "",
    createdAt: row.created_at ?? null,
  };
}

// Human-readable provenance for the audit trail.
export const EVENT_SOURCE_LABEL: Record<string, string> = {
  native_geofence: "Phone (background)",
  foreground_reconciliation: "App open",
  scheduled_reconciliation: "Scheduled check",
  offline_sync: "Synced from offline",
  employee_manual: "Employee (manual)",
  manager_correction: "Manager correction",
};

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
  enabled: true,
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
    // Attendance is permanent for every company. The legacy jobsite_time_enabled
    // column is no longer a product gate — a false/null value must NOT disable
    // Attendance — so it is always reported enabled. (Column kept, not dropped.)
    enabled: true,
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

// Short role codes / acronyms that read best fully uppercased in the UI
// (e.g. "PM - Smith Excavation", not "Pm - …").
const UPPERCASE_ROLE_LABELS = new Set([
  "pm",
  "ceo",
  "cfo",
  "coo",
  "cto",
  "vp",
  "hr",
  "it",
  "admin",
]);

// Human-facing role label for the Attendance roster. Uppercases short role
// codes/acronyms (PM, CEO, admin…), Title-cases everything else. Empty/unknown
// falls back to "Employee".
export function formatAttendanceRoleLabel(role: string | null | undefined): string {
  const raw = String(role ?? "").trim();
  if (!raw) return "Employee";
  const lower = raw.toLowerCase();
  if (UPPERCASE_ROLE_LABELS.has(lower) || (/^[a-z]+$/.test(lower) && lower.length <= 3)) {
    return raw.toUpperCase();
  }
  return raw
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

// Roster subtitle: "{roleLabel} - {jobName}", e.g. "PM - Smith Excavation".
// Only shows "Unassigned" when there is genuinely no job name/id — a bare jobId
// with no resolvable name still counts as assigned (shows "Assigned job")
// rather than wrongly reading as unassigned.
export function formatAssignedJobSubtitle(params: {
  role: string | null | undefined;
  jobName?: string | null;
  jobId?: string | number | null;
}): string {
  const roleLabel = formatAttendanceRoleLabel(params.role);
  const name = String(params.jobName ?? "").trim();
  const hasJobId = params.jobId !== null && params.jobId !== undefined && String(params.jobId).trim() !== "";
  const jobLabel = name || (hasJobId ? "Assigned job" : "Unassigned");
  return `${roleLabel} - ${jobLabel}`;
}

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
