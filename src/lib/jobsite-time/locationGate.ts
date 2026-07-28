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
 * Whether a user participates in automatic attendance (and so must pass the
 * location gate).
 *
 * The signal is ASSIGNMENT, not role: a user participates exactly when they are
 * assigned to at least one job (job_employees — the authoritative model). This
 * deliberately avoids a role allowlist. An assigned PM/operations user IS a
 * participant and is gated; a CEO/executive/admin-only user with no assignments
 * is not. When assignments can't be determined (fetch failure), the caller
 * treats it as zero — never gating without positive evidence of participation.
 */
export function isAttendanceParticipant(params: { assignedJobCount: number }): boolean {
  return params.assignedJobCount > 0;
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

// ── The tap-to-enable state machine (the fix for stuck "Requesting…") ─────────

// The permission step may legitimately wait on the OS dialog while the user
// decides, so it gets a long ceiling. The device-setup step has no user
// interaction, so it gets a short one. BOTH are bounded, so no step can leave
// the gate pinned on "Requesting…" forever.
export const LOCATION_SETUP_PERMISSION_TIMEOUT_MS = 60_000;
export const LOCATION_SETUP_STEP_TIMEOUT_MS = 15_000;

/** Terminal outcome of one enable attempt. Every path resolves to one of these
 *  — there is no "still pending forever". */
export type LocationSetupResult =
  | { status: "granted" }
  | { status: "denied" }
  | { status: "unavailable" }
  | { status: "timeout" }
  | { status: "enrollment_failed" };

type StepResult<T> =
  | { kind: "value"; value: T }
  | { kind: "timeout" }
  | { kind: "failure" };

/** Race one async step against a timeout while preserving failure vs stall. */
async function withStepTimeout<T>(op: Promise<T>, timeoutMs: number): Promise<StepResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<StepResult<T>>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
  });
  const guarded: Promise<StepResult<T>> = op.then(
    (value) => ({ kind: "value", value }),
    () => ({ kind: "failure" }),
  );
  try {
    return await Promise.race([guarded, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Orchestrate the two enable steps with a per-step ceiling. This is the fix for
 * the stuck "Requesting…" bug: the native permission request can never resolve
 * (iOS does not fire the authorization callback when the status is already
 * decided) and the credential-enrollment fetch had no timeout, so either could
 * hang the button forever. Bounding EACH step means every attempt terminates,
 * and the caller renders a concise, recoverable error instead of a dead button.
 *
 * Pure and dependency-injected so success / denial / timeout / credential
 * failure / retry are all unit-testable without a device.
 */
export async function runLocationSetup(deps: {
  requestPermission: () => Promise<LocationPermissionResult>;
  completeSetup: () => Promise<boolean>;
  permissionTimeoutMs?: number;
  setupTimeoutMs?: number;
  onTransition?: (step: "permission" | "enrollment") => void;
}): Promise<LocationSetupResult> {
  const permissionTimeoutMs = deps.permissionTimeoutMs ?? LOCATION_SETUP_PERMISSION_TIMEOUT_MS;
  const setupTimeoutMs = deps.setupTimeoutMs ?? LOCATION_SETUP_STEP_TIMEOUT_MS;

  deps.onTransition?.("permission");
  const permission = await withStepTimeout(
    Promise.resolve().then(deps.requestPermission),
    permissionTimeoutMs,
  );
  if (permission.kind === "timeout") return { status: "timeout" };
  if (permission.kind === "failure") return { status: "unavailable" };
  if (permission.value === "denied") return { status: "denied" };
  if (permission.value === "unavailable") return { status: "unavailable" };

  // permission === "granted": finish device setup (native credential enrollment).
  deps.onTransition?.("enrollment");
  const ready = await withStepTimeout(
    Promise.resolve().then(deps.completeSetup),
    setupTimeoutMs,
  );
  if (ready.kind === "timeout") return { status: "timeout" };
  if (ready.kind === "failure") return { status: "enrollment_failed" };
  return ready.value === true ? { status: "granted" } : { status: "enrollment_failed" };
}

/** Map a setup result to its error kind (or null when it succeeded). */
export function locationSetupErrorKind(result: LocationSetupResult): LocationSetupErrorKind | null {
  switch (result.status) {
    case "granted":
      return null;
    case "denied":
      return "denied";
    case "unavailable":
      return "unavailable";
    case "timeout":
      return "timeout";
    case "enrollment_failed":
      return "enrollment";
  }
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
  title: "Enable Location",
  /** Intentionally generic — no mention of attendance, clocking in/out, jobsite
   *  arrival/departure, or tracking. */
  body: "Groundwork Pro uses location for accuracy.",
  /** Shown once permission is denied — still generic. */
  deniedBody: "Location is required to continue. Please enable it in Settings.",
  request: "Enable Location",
  retry: "Try Again",
  settings: "Open Settings",
} as const;

/** The concrete way a setup attempt failed, for a concise recoverable message. */
export type LocationSetupErrorKind = "denied" | "unavailable" | "timeout" | "enrollment";

/** Concise error copy per failure — generic, no attendance/tracking wording. */
export const LOCATION_GATE_ERROR_COPY: Record<LocationSetupErrorKind, string> = {
  denied: "Location access was denied. Enable it in Settings to continue.",
  unavailable: "We couldn't start Location on this device. Please try again or enable Location in iOS Settings.",
  timeout: "That took too long. Please try again.",
  enrollment: "We couldn't finish setup on this device. Please try again.",
};

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
