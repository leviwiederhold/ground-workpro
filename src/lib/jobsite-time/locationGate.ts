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
  title: "Enable location",
  /** Shown before any denial. States the requirement plainly, without
   *  referencing attendance, jobsites, or tracking. */
  body: "Please enable location to continue using Groundwork Pro.",
  /** Shown once the user has denied. */
  deniedBody: "Location is required to continue using Groundwork Pro.",
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
