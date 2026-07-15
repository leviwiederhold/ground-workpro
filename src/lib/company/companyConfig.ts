// Canonical company-configuration schema + loaders.
//
// This is the SINGLE source of truth for the company-level settings that are
// collected during CEO/owner setup and remain editable in Settings. It is
// reused by:
//   - onboarding setup            (app/api/onboarding/complete)
//   - the Settings form + its API (app/api/company/settings)
//   - the Attendance config loader (app/api/jobsite-time/events)
//   - the CEO "finish setup" prompt (missing-field detection)
//
// Two hard rules from the product spec drive the design here:
//   1. Do NOT invent work-hour / timezone defaults. Legacy companies that are
//      missing this configuration are detected (getMissingCompanyConfigFields)
//      and prompted, never silently defaulted.
//   2. Attendance must not compute late/early status until a company has valid
//      work hours AND timezone — resolveCompanyWorkSchedule() returns null until
//      then, and callers must treat null as "no schedule".
//
// Optional tuning knobs (early-arrival window, late grace, geofence radius) are
// NOT part of "required config"; they carry sensible defaults because they only
// refine an already-valid schedule.

import { z } from "zod";
// Type-only import (erased at runtime) so this module stays self-contained and
// directly unit-testable under `node --test` without a path-alias resolver.
import type { CompanyWorkScheduleSettings } from "@/lib/jobsite-time/domain";

// Optional attendance-tuning defaults. These mirror the same-named constants in
// jobsite-time/domain.ts; they are OPTIONAL knobs (not "required config"), so a
// sensible default is allowed here — unlike work hours / timezone, which are
// never invented.
export const DEFAULT_EARLY_ARRIVAL_WINDOW_MINUTES = 120;
export const DEFAULT_LATE_GRACE_MINUTES = 10;

export const WORK_DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type WorkDayKey = (typeof WORK_DAY_KEYS)[number];

export const DEFAULT_GEOFENCE_RADIUS_FEET = 5280;

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

// ---------------------------------------------------------------------------
// Strict parsers — return the normalized value, or null when absent/invalid.
// Unlike the lenient normalizers in domain.ts, these NEVER substitute a
// default, so callers can distinguish "configured" from "missing".
// ---------------------------------------------------------------------------

export function parseTimezone(value: unknown): string | null {
  const tz = String(value ?? "").trim();
  if (!tz) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return null;
  }
}

export function parseWorkTime(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function parseWorkDays(value: unknown): WorkDayKey[] | null {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const days = raw
    .map((day) => String(day).trim().toLowerCase().slice(0, 3))
    .filter((day): day is WorkDayKey => (WORK_DAY_KEYS as readonly string[]).includes(day));
  if (days.length === 0) return null;
  // De-dupe while preserving canonical (Sun→Sat) order.
  return WORK_DAY_KEYS.filter((day) => days.includes(day));
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function resolveGeofenceRadiusFeet(value: unknown): number {
  return clampInt(value, DEFAULT_GEOFENCE_RADIUS_FEET, 100, 52800);
}

// ---------------------------------------------------------------------------
// Attendance configuration loader.
// Returns the fully-resolved schedule, or null when the company has not yet
// configured the REQUIRED fields (timezone + work days + start + end). Callers
// MUST treat null as "no schedule / do not compute attendance status".
// ---------------------------------------------------------------------------

export type CompanyConfigRow = {
  timezone?: string | null;
  default_work_days?: string[] | null;
  default_work_start_time?: string | null;
  default_work_end_time?: string | null;
  attendance_early_arrival_window_minutes?: number | null;
  attendance_late_grace_minutes?: number | null;
  jobsite_geofence_radius_feet?: number | null;
};

export function resolveCompanyWorkSchedule(
  row: CompanyConfigRow | null | undefined
): CompanyWorkScheduleSettings | null {
  const timezone = parseTimezone(row?.timezone);
  const workDays = parseWorkDays(row?.default_work_days);
  const workStartTime = parseWorkTime(row?.default_work_start_time);
  const workEndTime = parseWorkTime(row?.default_work_end_time);
  if (!timezone || !workDays || !workStartTime || !workEndTime) return null;
  return {
    timezone,
    workDays,
    workStartTime,
    workEndTime,
    earlyArrivalWindowMinutes: clampInt(
      row?.attendance_early_arrival_window_minutes,
      DEFAULT_EARLY_ARRIVAL_WINDOW_MINUTES,
      0,
      720
    ),
    lateGraceMinutes: clampInt(
      row?.attendance_late_grace_minutes,
      DEFAULT_LATE_GRACE_MINUTES,
      0,
      240
    ),
  };
}

// ---------------------------------------------------------------------------
// Missing-config detection — drives the focused CEO completion prompt.
// ---------------------------------------------------------------------------

export type CompanyConfigField = { key: string; label: string };

export const REQUIRED_COMPANY_CONFIG_FIELDS: readonly CompanyConfigField[] = [
  { key: "timezone", label: "Company timezone" },
  { key: "default_work_days", label: "Work days" },
  { key: "default_work_start_time", label: "Workday start time" },
  { key: "default_work_end_time", label: "Workday end time" },
] as const;

export function getMissingCompanyConfigFields(
  row: CompanyConfigRow | null | undefined
): CompanyConfigField[] {
  const missing: CompanyConfigField[] = [];
  if (!parseTimezone(row?.timezone)) missing.push(REQUIRED_COMPANY_CONFIG_FIELDS[0]);
  if (!parseWorkDays(row?.default_work_days)) missing.push(REQUIRED_COMPANY_CONFIG_FIELDS[1]);
  if (!parseWorkTime(row?.default_work_start_time)) missing.push(REQUIRED_COMPANY_CONFIG_FIELDS[2]);
  if (!parseWorkTime(row?.default_work_end_time)) missing.push(REQUIRED_COMPANY_CONFIG_FIELDS[3]);
  return missing;
}

export function isCompanyConfigComplete(row: CompanyConfigRow | null | undefined): boolean {
  return getMissingCompanyConfigFields(row).length === 0;
}

// CEO/owner === "admin" in this app's role model. Only they may read/write the
// company configuration; the settings API enforces the same rule server-side.
export function canEditCompanyConfig(role: string | null | undefined): boolean {
  return String(role ?? "").toLowerCase() === "admin";
}

// ---------------------------------------------------------------------------
// Canonical validation — the SAME zod field validators are shared by Setup
// (onboarding/complete) and Settings (company/settings) so timezone and
// work-hour validation are provably identical in both flows.
// ---------------------------------------------------------------------------

export const timezoneField = z
  .string()
  .trim()
  .min(1, "Company timezone is required.")
  .max(120)
  .refine((v) => parseTimezone(v) !== null, "Enter a valid timezone.");

export const workDaysField = z
  .array(z.enum(WORK_DAY_KEYS))
  .min(1, "Select at least one work day.");

export const workTimeField = z
  .string()
  .trim()
  .regex(TIME_RE, "Enter a valid time (HH:MM).");

export const earlyArrivalWindowField = z.coerce.number().int().min(0).max(720);
export const lateGraceField = z.coerce.number().int().min(0).max(240);
export const geofenceRadiusField = z.coerce.number().int().min(100).max(52800);

// The company work-hours block, shared by both APIs via `.partial()` (a caller
// may send a subset, but any field present is validated by these exact rules).
export const companyWorkHoursSchema = z.object({
  default_work_days: workDaysField,
  default_work_start_time: workTimeField,
  default_work_end_time: workTimeField,
  attendance_early_arrival_window_minutes: earlyArrivalWindowField,
  attendance_late_grace_minutes: lateGraceField,
  jobsite_geofence_radius_feet: geofenceRadiusField,
});

export type CompanyWorkHoursInput = z.infer<typeof companyWorkHoursSchema>;
