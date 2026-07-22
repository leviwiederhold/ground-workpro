// Company-level automatic-attendance configuration — the single source of truth
// consumed by BOTH the server (event evaluation, reconciliation) and the native
// client. Defaults live here so no component hard-codes them.

import { DEFAULT_COMPANY_TIMEZONE } from "../jobsite-time/domain.ts";

export type EarlyArrivalMode = "clock_in_on_arrival" | "scheduled_start";
export const EARLY_ARRIVAL_MODES: EarlyArrivalMode[] = ["clock_in_on_arrival", "scheduled_start"];

export type AutomaticAttendanceSettings = {
  // Master switch for the automatic pipeline (manual entry always remains).
  automaticAttendanceEnabled: boolean;
  // Minutes before scheduled start that monitoring begins.
  monitoringLeadMinutes: number;
  // Arrival (small) geofence radius, in meters.
  geofenceRadiusMeters: number;
  // Continuous minutes inside the radius before arrival is confirmed.
  arrivalDwellMinutes: number;
  // Early arrival behavior: clock in on confirmed arrival, or wait for shift start.
  earlyArrivalMode: EarlyArrivalMode;
  // Minutes outside the radius before a departure/clock-out is recorded.
  departureGraceMinutes: number;
  // Minutes after scheduled end when monitoring stops for the day.
  endOfDayCutoffMinutes: number;
  // Whether employees may fall back to manual clock in/out.
  manualFallbackEnabled: boolean;
  // Company timezone — ALL attendance time math uses this.
  timezone: string;
};

export const DEFAULT_AUTOMATIC_ATTENDANCE_SETTINGS: AutomaticAttendanceSettings = {
  automaticAttendanceEnabled: true,
  monitoringLeadMinutes: 120,
  geofenceRadiusMeters: 200,
  arrivalDwellMinutes: 2,
  earlyArrivalMode: "scheduled_start",
  departureGraceMinutes: 10,
  endOfDayCutoffMinutes: 180,
  manualFallbackEnabled: true,
  timezone: DEFAULT_COMPANY_TIMEZONE,
};

// Validation bounds. Kept here so server validation and any client-side form
// checks agree exactly.
export const ATTENDANCE_SETTINGS_BOUNDS = {
  monitoringLeadMinutes: { min: 0, max: 720 },
  geofenceRadiusMeters: { min: 50, max: 5000 },
  arrivalDwellMinutes: { min: 0, max: 60 },
  departureGraceMinutes: { min: 0, max: 120 },
  endOfDayCutoffMinutes: { min: 0, max: 1440 },
} as const;

function isValidTimezone(tz: unknown): boolean {
  if (typeof tz !== "string" || tz.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function isIntInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

export type AttendanceSettingsValidation =
  | { ok: true; value: Partial<AutomaticAttendanceSettings> }
  | { ok: false; errors: Record<string, string> };

/**
 * Validate a partial settings patch. Every provided field is bounds-checked;
 * invalid values are rejected (never silently clamped) so the caller sees a 422.
 */
export function validateAttendanceSettingsPatch(input: unknown): AttendanceSettingsValidation {
  if (!input || typeof input !== "object") {
    return { ok: false, errors: { _root: "Body must be an object" } };
  }
  const patch = input as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const value: Partial<AutomaticAttendanceSettings> = {};

  const B = ATTENDANCE_SETTINGS_BOUNDS;
  const numFields: Array<[keyof typeof B, keyof AutomaticAttendanceSettings]> = [
    ["monitoringLeadMinutes", "monitoringLeadMinutes"],
    ["geofenceRadiusMeters", "geofenceRadiusMeters"],
    ["arrivalDwellMinutes", "arrivalDwellMinutes"],
    ["departureGraceMinutes", "departureGraceMinutes"],
    ["endOfDayCutoffMinutes", "endOfDayCutoffMinutes"],
  ];
  for (const [boundKey, field] of numFields) {
    if (patch[field] === undefined) continue;
    const { min, max } = B[boundKey];
    if (!isIntInRange(patch[field], min, max)) {
      errors[field] = `${field} must be an integer between ${min} and ${max}`;
    } else {
      (value as Record<string, unknown>)[field] = patch[field];
    }
  }

  for (const field of ["automaticAttendanceEnabled", "manualFallbackEnabled"] as const) {
    if (patch[field] === undefined) continue;
    if (typeof patch[field] !== "boolean") errors[field] = `${field} must be a boolean`;
    else value[field] = patch[field] as boolean;
  }

  if (patch.earlyArrivalMode !== undefined) {
    if (!EARLY_ARRIVAL_MODES.includes(patch.earlyArrivalMode as EarlyArrivalMode)) {
      errors.earlyArrivalMode = `earlyArrivalMode must be one of ${EARLY_ARRIVAL_MODES.join(", ")}`;
    } else {
      value.earlyArrivalMode = patch.earlyArrivalMode as EarlyArrivalMode;
    }
  }

  if (patch.timezone !== undefined) {
    if (!isValidTimezone(patch.timezone)) errors.timezone = "timezone must be a valid IANA timezone";
    else value.timezone = String(patch.timezone);
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value };
}

// ── Persistence mapping (company columns <-> settings) ─────────────────────────

const COLUMN_BY_FIELD: Record<keyof AutomaticAttendanceSettings, string> = {
  automaticAttendanceEnabled: "attendance_automatic_enabled",
  monitoringLeadMinutes: "attendance_early_arrival_window_minutes",
  geofenceRadiusMeters: "attendance_geofence_radius_meters",
  arrivalDwellMinutes: "attendance_arrival_dwell_minutes",
  earlyArrivalMode: "attendance_early_arrival_mode",
  departureGraceMinutes: "attendance_departure_grace_minutes",
  endOfDayCutoffMinutes: "attendance_end_of_day_cutoff_minutes",
  manualFallbackEnabled: "jobsite_manual_fallback_enabled",
  timezone: "timezone",
};

export const ATTENDANCE_SETTINGS_COLUMNS = Array.from(new Set(Object.values(COLUMN_BY_FIELD))).join(", ");

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Map a company row (any subset of columns present) to full settings + defaults. */
export function mapRowToAttendanceSettings(row: Record<string, unknown> | null | undefined): AutomaticAttendanceSettings {
  const d = DEFAULT_AUTOMATIC_ATTENDANCE_SETTINGS;
  const r = row ?? {};
  const mode = String(r.attendance_early_arrival_mode ?? d.earlyArrivalMode);
  const bool = (value: unknown, fallback: boolean): boolean =>
    value === null || value === undefined ? fallback : Boolean(value);
  return {
    automaticAttendanceEnabled: bool(r.attendance_automatic_enabled, d.automaticAttendanceEnabled),
    monitoringLeadMinutes: num(r.attendance_early_arrival_window_minutes, d.monitoringLeadMinutes),
    geofenceRadiusMeters: num(r.attendance_geofence_radius_meters, d.geofenceRadiusMeters),
    arrivalDwellMinutes: num(r.attendance_arrival_dwell_minutes, d.arrivalDwellMinutes),
    earlyArrivalMode: (EARLY_ARRIVAL_MODES.includes(mode as EarlyArrivalMode) ? mode : d.earlyArrivalMode) as EarlyArrivalMode,
    departureGraceMinutes: num(r.attendance_departure_grace_minutes, d.departureGraceMinutes),
    endOfDayCutoffMinutes: num(r.attendance_end_of_day_cutoff_minutes, d.endOfDayCutoffMinutes),
    manualFallbackEnabled: bool(r.jobsite_manual_fallback_enabled, d.manualFallbackEnabled),
    timezone: String(r.timezone ?? "").trim() || d.timezone,
  };
}

/**
 * The arrival dwell the pipeline actually enforces, in seconds.
 *
 * Two columns can express it: the newer `attendance_arrival_dwell_minutes`
 * (this module) and the original `jobsite_arrival_confirmation_seconds` (the
 * two-zone geofence settings). Taking the STRICTER of the two means neither
 * knob can silently loosen arrival confirmation, and every caller — events
 * route, foreground reconciliation, scheduled process — enforces the same
 * number.
 */
export function resolveArrivalConfirmationSeconds(
  attendance: Pick<AutomaticAttendanceSettings, "arrivalDwellMinutes">,
  legacyArrivalConfirmationSeconds: number | null | undefined
): number {
  const dwellSeconds = Math.max(0, Math.round(attendance.arrivalDwellMinutes * 60));
  const legacy = Number(legacyArrivalConfirmationSeconds);
  return Number.isFinite(legacy) ? Math.max(dwellSeconds, legacy) : dwellSeconds;
}

/** Build a company-columns update object from a validated settings patch. */
export function buildAttendanceSettingsUpdate(patch: Partial<AutomaticAttendanceSettings>): Record<string, unknown> {
  const update: Record<string, unknown> = {};
  for (const key of Object.keys(patch) as Array<keyof AutomaticAttendanceSettings>) {
    if (patch[key] === undefined) continue;
    update[COLUMN_BY_FIELD[key]] = patch[key];
  }
  return update;
}
