// Decision logic for the required startup location gate.
//
// Location is a prerequisite for entering Groundwork Pro: after authentication
// the app checks permission and, unless it is granted, renders the gate instead
// of any application content. This module holds the pure decisions so they can
// be unit-tested without a DOM.

import type { LocationPermissionResult, LocationPermissionState } from "./locationPermission";

export type LocationGateStatus =
  /** Still resolving. Render NOTHING — never the dashboard, never the gate. */
  | "checking"
  /** Permission granted. Render the application. */
  | "granted"
  /** Ask for permission. */
  | "blocked";

export function resolveLocationGateStatus(
  permission: LocationPermissionState | "checking" | null | undefined,
): LocationGateStatus {
  if (permission == null || permission === "checking") return "checking";
  return permission === "granted" ? "granted" : "blocked";
}

/** Default ceiling for the startup permission check. */
export const LOCATION_CHECK_TIMEOUT_MS = 4000;

/**
 * Bounded gate-status resolution for the startup gate.
 *
 * The gate renders NOTHING while it is `checking`, so a check that never settles
 * leaves the entire app blank. This was the physical-iPhone white screen: on
 * native the check awaits a dynamic import of the Capacitor Geolocation plugin
 * and then a bridge call (and, for participants, native health), and any of
 * those can stall and never resolve — leaving the wrapper stuck on `checking`.
 *
 * Racing the resolver against a timeout guarantees the gate always leaves the
 * `checking` state. A timed-out OR rejected resolve both fall back to `blocked`,
 * which shows the location setup UI instead of a blank screen — always
 * recoverable (the user can grant, and the wrapper's focus/visibility re-check
 * lets a genuinely-ready user straight in) unlike a blank that never clears.
 */
export async function resolveGateStatusWithTimeout(
  resolve: () => Promise<LocationGateStatus>,
  timeoutMs: number = LOCATION_CHECK_TIMEOUT_MS,
): Promise<LocationGateStatus> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<LocationGateStatus>((res) => {
    timer = setTimeout(() => res("blocked"), timeoutMs);
  });
  const resolved: Promise<LocationGateStatus> = Promise.resolve()
    .then(resolve)
    .catch((): LocationGateStatus => "blocked");
  try {
    return await Promise.race([resolved, timedOut]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── Who is subject to the attendance location gate ───────────────────────────

/**
 * Roles that do NOT participate in automatic jobsite attendance and therefore
 * must never be gated on location merely for being authenticated. Both role
 * vocabularies are covered: the UI roles (`executive`, `operations`) and their
 * server equivalents (`admin`, `pm`). Everyone else — foreman, operator,
 * mechanic, field staff — is a field participant whose attendance is recorded by
 * geofence and so needs location set up.
 */
const NON_PARTICIPANT_ROLES = new Set(["executive", "admin", "operations", "pm"]);

/**
 * Whether a user participates in automatic attendance (and so must pass the
 * location gate). Management/office roles do not. An unknown/empty role returns
 * false: we never demand location without positive evidence the user is a field
 * participant, so a not-yet-hydrated role never gates a CEO/admin.
 */
export function participatesInAutomaticAttendance(role: string | null | undefined): boolean {
  const normalized = String(role ?? "").trim().toLowerCase();
  if (normalized === "") return false;
  return !NON_PARTICIPANT_ROLES.has(normalized);
}

export type GatePlatform = "native" | "web";

/**
 * Whether attendance location setup is COMPLETE for a participant.
 *
 *   web    → location permission granted is sufficient. A web session has no
 *            secure store, so requiring a native device credential there would
 *            lock web users out permanently.
 *   native → permission granted AND a device credential is enrolled. Background
 *            arrival/departure events cannot be submitted without the credential,
 *            so permission alone is not "set up" on a device.
 */
export function isAttendanceSetupComplete(params: {
  platform: GatePlatform;
  permission: LocationPermissionState | "checking";
  hasDeviceCredential: boolean;
}): boolean {
  if (params.permission !== "granted") return false;
  return params.platform === "native" ? params.hasDeviceCredential === true : true;
}

export type GateAction =
  /** The platform can still surface the OS/browser dialog. */
  | "request"
  /** The dialog will no longer appear; the user must change it in settings. */
  | "settings";

/**
 * Which primary action the gate should offer.
 *
 * The distinction is not cosmetic. Once a user denies, iOS never shows the
 * dialog again and browsers stop prompting for that origin, so a "Try Again"
 * button would silently do nothing — the user has to change it in settings. We
 * therefore only keep offering a retry while the platform reports it can still
 * prompt.
 *
 * `attempted` matters because the very first render has made no request yet: the
 * state may already read "denied" from a previous session, but we have not tried
 * in this session, and on some platforms a fresh request still surfaces.
 */
export function resolveGateAction(params: {
  permission: LocationPermissionState | "checking";
  lastResult: LocationPermissionResult | null;
}): GateAction {
  const { permission, lastResult } = params;

  // A denial we just observed, confirmed by the platform still reporting denied,
  // means the prompt is exhausted.
  if (lastResult === "denied" && permission === "denied") return "settings";

  // Platform reports denied and we have not been told otherwise — the dialog is
  // already spent from an earlier session.
  if (permission === "denied") return "settings";

  // "prompt", "unavailable", or "checking" — a request is still worth making.
  return "request";
}

export const LOCATION_GATE_COPY = {
  title: "Enable location for attendance",
  /** Shown before any denial. Explains exactly what location is for: automatic
   *  jobsite attendance (arrival/departure detection), and explicitly that it is
   *  NOT continuous tracking. */
  body:
    "Groundwork Pro uses your location for automatic jobsite attendance — detecting when you arrive at and leave a jobsite so you're clocked in and out without doing it by hand. It checks your location only to detect jobsite arrival and departure. It does not continuously track your location.",
  /** Shown once the user has denied — same explanation, framed as required. */
  deniedBody:
    "Location is required for automatic jobsite attendance — detecting when you arrive at and leave a jobsite. Groundwork Pro checks your location only for jobsite arrival and departure and does not continuously track your location. Please enable it to continue.",
  request: "Enable location",
  retry: "Try Again",
  settings: "Open Settings",
} as const;

/** The body copy for the current state. */
export function resolveGateBody(lastResult: LocationPermissionResult | null): string {
  return lastResult === "denied" || lastResult === "unavailable"
    ? LOCATION_GATE_COPY.deniedBody
    : LOCATION_GATE_COPY.body;
}

/** The primary button label for the current state. */
export function resolveGateButtonLabel(params: {
  action: GateAction;
  lastResult: LocationPermissionResult | null;
}): string {
  if (params.action === "settings") return LOCATION_GATE_COPY.settings;
  return params.lastResult === null ? LOCATION_GATE_COPY.request : LOCATION_GATE_COPY.retry;
}
