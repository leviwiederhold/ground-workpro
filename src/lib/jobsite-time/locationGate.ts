// Decision logic for the required startup location gate.
//
// Location is a prerequisite for entering Groundwork Pro: after authentication
// the app checks permission and, unless it is granted, renders the gate instead
// of any application content. This module holds the pure decisions so they can
// be unit-tested without a DOM.

import type { LocationPermissionResult, LocationPermissionState } from "./locationPermission";
import type { NativeGeofenceHealth } from "../attendance/nativeGeofence";

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

/** Retry only transient native bridge failures during a cold-launch warmup. */
export async function retryTransientNativeRead<T>(
  read: () => Promise<T>,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 8);
  const delayMs = Math.max(0, options.delayMs ?? 150);
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("native readiness check failed");
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
 *   native → foreground permission, Always authorization, Precise Location,
 *            native service health, a device credential, and every required
 *            assigned region confirmed by Core Location.
 */
export function isAttendanceSetupComplete(params: {
  platform: GatePlatform;
  permission: LocationPermissionState | "checking";
  hasDeviceCredential: boolean;
  nativeHealth?: Pick<
    NativeGeofenceHealth,
    | "supported"
    | "authorized"
    | "authorizationStatus"
    | "locationServicesEnabled"
    | "backgroundRefreshEnabled"
    | "preciseLocation"
  > | null;
  requiredRegionIds?: string[];
  registeredRegionIds?: string[];
}): boolean {
  if (params.permission !== "granted") return false;
  if (params.platform !== "native") return true;

  const health = params.nativeHealth;
  if (
    !health?.supported ||
    !health.authorized ||
    health.locationServicesEnabled !== true ||
    health.backgroundRefreshEnabled !== true ||
    health.preciseLocation !== true ||
    params.hasDeviceCredential !== true
  ) {
    return false;
  }

  const required = params.requiredRegionIds ?? [];
  const registered = new Set(params.registeredRegionIds ?? []);
  return required.length > 0 && required.every((identifier) => registered.has(identifier));
}

// ── The tap-to-enable state machine (the fix for stuck "Requesting…") ─────────

export type LocationSetupStage =
  | "checking_location_permission"
  | "requesting_location_permission"
  | "native_geofence_health"
  | "requesting_background_authorization"
  | "secure_credential_enrollment"
  | "secure_store_write"
  | "assigned_location_registration"
  | "completion";

export type LocationSetupFailureCode =
  | "LOCATION_PERMISSION_CHECK_TIMEOUT"
  | "LOCATION_PERMISSION_CHECK_FAILED"
  | "LOCATION_PERMISSION_REQUEST_TIMEOUT"
  | "LOCATION_PERMISSION_REQUEST_FAILED"
  | "NATIVE_GEOFENCE_HEALTH_TIMEOUT"
  | "NATIVE_GEOFENCE_HEALTH_FAILED"
  | "BACKGROUND_AUTHORIZATION_REQUEST_TIMEOUT"
  | "BACKGROUND_AUTHORIZATION_REQUEST_FAILED"
  | "SECURE_CREDENTIAL_ENROLLMENT_TIMEOUT"
  | "SECURE_CREDENTIAL_ENROLLMENT_FAILED"
  | "SECURE_STORE_WRITE_TIMEOUT"
  | "SECURE_STORE_WRITE_FAILED"
  | "ASSIGNED_LOCATION_REGISTRATION_TIMEOUT"
  | "ASSIGNED_LOCATION_REGISTRATION_FAILED"
  | "LOCATION_SETUP_COMPLETION_TIMEOUT"
  | "LOCATION_SETUP_COMPLETION_FAILED";

export const LOCATION_SETUP_STAGE_TIMEOUT_MS: Record<LocationSetupStage, number> = {
  checking_location_permission: 10_000,
  // The only user-controlled wait: iOS may leave the permission sheet visible
  // while the user reads it.
  requesting_location_permission: 60_000,
  native_geofence_health: 10_000,
  requesting_background_authorization: 60_000,
  secure_credential_enrollment: 15_000,
  secure_store_write: 10_000,
  assigned_location_registration: 15_000,
  completion: 10_000,
};

type LocationSetupFailure = {
  status: "failed";
  stage: LocationSetupStage;
  code: LocationSetupFailureCode;
  kind: "timeout" | "failure";
  detail?: string;
};

/** Terminal outcome of one enable attempt. */
export type LocationSetupResult =
  | { status: "granted" }
  | {
      status: "settings_required";
      stage: "native_geofence_health";
      code:
        | "IOS_LOCATION_SERVICES_REQUIRED"
        | "IOS_BACKGROUND_REFRESH_REQUIRED"
        | "IOS_BACKGROUND_LOCATION_REQUIRED"
        | "IOS_PRECISE_LOCATION_REQUIRED";
    }
  | {
      status: "denied";
      stage: "checking_location_permission" | "requesting_location_permission";
      code: "IOS_LOCATION_PERMISSION_DENIED";
    }
  | LocationSetupFailure;

type StageResult<T> =
  | { kind: "value"; value: T }
  | { kind: "timeout" }
  | { kind: "failure"; error: unknown };

export type LocationSetupTransition = {
  stage: LocationSetupStage;
  state: "started" | "succeeded" | "skipped";
};

const STAGE_CODES: Record<
  LocationSetupStage,
  { timeout: LocationSetupFailureCode; failure: LocationSetupFailureCode }
> = {
  checking_location_permission: {
    timeout: "LOCATION_PERMISSION_CHECK_TIMEOUT",
    failure: "LOCATION_PERMISSION_CHECK_FAILED",
  },
  requesting_location_permission: {
    timeout: "LOCATION_PERMISSION_REQUEST_TIMEOUT",
    failure: "LOCATION_PERMISSION_REQUEST_FAILED",
  },
  native_geofence_health: {
    timeout: "NATIVE_GEOFENCE_HEALTH_TIMEOUT",
    failure: "NATIVE_GEOFENCE_HEALTH_FAILED",
  },
  requesting_background_authorization: {
    timeout: "BACKGROUND_AUTHORIZATION_REQUEST_TIMEOUT",
    failure: "BACKGROUND_AUTHORIZATION_REQUEST_FAILED",
  },
  secure_credential_enrollment: {
    timeout: "SECURE_CREDENTIAL_ENROLLMENT_TIMEOUT",
    failure: "SECURE_CREDENTIAL_ENROLLMENT_FAILED",
  },
  secure_store_write: {
    timeout: "SECURE_STORE_WRITE_TIMEOUT",
    failure: "SECURE_STORE_WRITE_FAILED",
  },
  assigned_location_registration: {
    timeout: "ASSIGNED_LOCATION_REGISTRATION_TIMEOUT",
    failure: "ASSIGNED_LOCATION_REGISTRATION_FAILED",
  },
  completion: {
    timeout: "LOCATION_SETUP_COMPLETION_TIMEOUT",
    failure: "LOCATION_SETUP_COMPLETION_FAILED",
  },
};

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

/** Race exactly one named transition against its own ceiling. */
async function runStage<T>(
  stage: LocationSetupStage,
  operation: (signal: AbortSignal) => Promise<T>,
  onTransition?: (transition: LocationSetupTransition) => void,
  timeoutMs: number = LOCATION_SETUP_STAGE_TIMEOUT_MS[stage],
): Promise<T | LocationSetupFailure> {
  onTransition?.({ stage, state: "started" });
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<StageResult<T>>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ kind: "timeout" });
    }, timeoutMs);
  });
  const guarded: Promise<StageResult<T>> = Promise.resolve()
    .then(() => operation(controller.signal))
    .then(
      (value) => ({ kind: "value", value }),
      (error) => ({ kind: "failure", error }),
    );
  try {
    const result = await Promise.race([guarded, timeout]);
    if (result.kind === "timeout") {
      return { status: "failed", stage, code: STAGE_CODES[stage].timeout, kind: "timeout" };
    }
    if (result.kind === "failure") {
      return {
        status: "failed",
        stage,
        code: STAGE_CODES[stage].failure,
        kind: "failure",
        detail: errorDetail(result.error),
      };
    }
    onTransition?.({ stage, state: "succeeded" });
    return result.value;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isFailure<T>(value: T | LocationSetupFailure): value is LocationSetupFailure {
  return typeof value === "object" && value !== null && "status" in value && value.status === "failed";
}

export type LocationSetupDependencies<Credential = unknown> = {
  native: boolean;
  checkPermission: () => Promise<LocationPermissionState>;
  requestPermission: () => Promise<LocationPermissionResult>;
  checkNativeGeofenceHealth: () => Promise<NativeGeofenceHealth>;
  requestBackgroundAuthorization: () => Promise<void>;
  enrollSecureCredential: (signal: AbortSignal) => Promise<Credential>;
  writeSecureCredential: (credential: Credential) => Promise<void>;
  registerAssignedLocations: () => Promise<{
    requiredRegionIds: string[];
    registeredRegionIds: string[];
  }>;
  verifyCompletion: () => Promise<boolean>;
  onTransition?: (transition: LocationSetupTransition) => void;
  stageTimeoutMs?: Partial<Record<LocationSetupStage, number>>;
};

/**
 * Explicit transitions replace the old two coarse timers. A physical iOS
 * stall now identifies the exact bridge/network/Keychain boundary and code.
 * There is no global wrapper timeout and no automatic retry.
 */
export async function runLocationSetup<Credential>(
  deps: LocationSetupDependencies<Credential>,
): Promise<LocationSetupResult> {
  const run = <T>(stage: LocationSetupStage, op: (signal: AbortSignal) => Promise<T>) =>
    runStage(stage, op, deps.onTransition, deps.stageTimeoutMs?.[stage]);
  const skip = (stage: LocationSetupStage) => deps.onTransition?.({ stage, state: "skipped" });

  let permission = await run("checking_location_permission", () => deps.checkPermission());
  if (isFailure(permission)) return permission;
  if (permission === "denied") {
    return {
      status: "denied",
      stage: "checking_location_permission",
      code: "IOS_LOCATION_PERMISSION_DENIED",
    };
  }
  if (permission === "unavailable") {
    return {
      status: "failed",
      stage: "checking_location_permission",
      code: "LOCATION_PERMISSION_CHECK_FAILED",
      kind: "failure",
      detail: "location permission is unavailable",
    };
  }

  if (permission === "prompt") {
    const requested = await run("requesting_location_permission", () => deps.requestPermission());
    if (isFailure(requested)) return requested;
    if (requested === "denied") {
      return {
        status: "denied",
        stage: "requesting_location_permission",
        code: "IOS_LOCATION_PERMISSION_DENIED",
      };
    }
    if (requested === "unavailable") {
      return {
        status: "failed",
        stage: "requesting_location_permission",
        code: "LOCATION_PERMISSION_REQUEST_FAILED",
        kind: "failure",
        detail: "location permission request is unavailable",
      };
    }

    // Do not trust only the request callback; verify the OS state independently.
    permission = await run("checking_location_permission", () => deps.checkPermission());
    if (isFailure(permission)) return permission;
    if (permission !== "granted") {
      return permission === "denied"
        ? {
            status: "denied",
            stage: "checking_location_permission",
            code: "IOS_LOCATION_PERMISSION_DENIED",
          }
        : {
            status: "failed",
            stage: "checking_location_permission",
            code: "LOCATION_PERMISSION_CHECK_FAILED",
            kind: "failure",
            detail: `post-request permission state was ${permission}`,
          };
    }
  } else {
    skip("requesting_location_permission");
  }

  if (!deps.native) {
    skip("native_geofence_health");
    skip("requesting_background_authorization");
    skip("secure_credential_enrollment");
    skip("secure_store_write");
    skip("assigned_location_registration");
  } else {
    let health = await run("native_geofence_health", () => deps.checkNativeGeofenceHealth());
    if (isFailure(health)) return health;
    if (!health.supported) {
      return {
        status: "failed",
        stage: "native_geofence_health",
        code: "NATIVE_GEOFENCE_HEALTH_FAILED",
        kind: "failure",
        detail: "native geofence service is unsupported",
      };
    }
    if (health.locationServicesEnabled !== true) {
      return {
        status: "settings_required",
        stage: "native_geofence_health",
        code: "IOS_LOCATION_SERVICES_REQUIRED",
      };
    }
    if (health.backgroundRefreshEnabled !== true) {
      return {
        status: "settings_required",
        stage: "native_geofence_health",
        code: "IOS_BACKGROUND_REFRESH_REQUIRED",
      };
    }
    if (health.preciseLocation !== true) {
      return {
        status: "settings_required",
        stage: "native_geofence_health",
        code: "IOS_PRECISE_LOCATION_REQUIRED",
      };
    }
    if (!health.authorized) {
      const backgroundRequest = await run(
        "requesting_background_authorization",
        () => deps.requestBackgroundAuthorization(),
      );
      if (isFailure(backgroundRequest)) return backgroundRequest;
      health = await run("native_geofence_health", () => deps.checkNativeGeofenceHealth());
      if (isFailure(health)) return health;
      if (!health.authorized) {
        return {
          status: "settings_required",
          stage: "native_geofence_health",
          code: "IOS_BACKGROUND_LOCATION_REQUIRED",
        };
      }
    } else {
      skip("requesting_background_authorization");
    }

    if (health.hasCredential) {
      skip("secure_credential_enrollment");
      skip("secure_store_write");
    } else {
      const credential = await run(
        "secure_credential_enrollment",
        (signal) => deps.enrollSecureCredential(signal),
      );
      if (isFailure(credential)) return credential;
      const write = await run("secure_store_write", () => deps.writeSecureCredential(credential));
      if (isFailure(write)) return write;
    }

    const registration = await run(
      "assigned_location_registration",
      () => deps.registerAssignedLocations(),
    );
    if (isFailure(registration)) return registration;
    if (
      registration.requiredRegionIds.length === 0 ||
      !registration.requiredRegionIds.every((identifier) =>
        registration.registeredRegionIds.includes(identifier),
      )
    ) {
      return {
        status: "failed",
        stage: "assigned_location_registration",
        code: "ASSIGNED_LOCATION_REGISTRATION_FAILED",
        kind: "failure",
        detail: "assigned locations were not registered",
      };
    }
  }

  const complete = await run("completion", () => deps.verifyCompletion());
  if (isFailure(complete)) return complete;
  if (!complete) {
    return {
      status: "failed",
      stage: "completion",
      code: "LOCATION_SETUP_COMPLETION_FAILED",
      kind: "failure",
      detail: "completion verification returned false",
    };
  }
  return { status: "granted" };
}

/** Map a setup result to the visible error code (or null on success/denial). */
export function locationSetupErrorKind(result: LocationSetupResult): LocationSetupErrorKind | null {
  if (
    result.status === "granted" ||
    result.status === "denied" ||
    result.status === "settings_required"
  ) {
    return null;
  }
  return result.code;
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
  deniedBody: "Location access needs one more step.",
  request: "Enable Location",
  retry: "Try Again",
  settings: "Open Settings",
} as const;

/** Google Play requires this Android-only disclosure immediately before the
 * background-location permission flow. It is deliberately separate from the
 * neutral iOS downgrade gate. */
export const ANDROID_BACKGROUND_LOCATION_DISCLOSURE = {
  title: "Background location",
  body:
    "Groundwork Pro collects location data to enable automatic jobsite arrival and departure attendance, even when the app is closed or not in use. It records discrete jobsite events and does not create a continuous location history.",
  continue: "Continue",
} as const;

/** The exact recoverable failure code shown by the gate. */
export type LocationSetupErrorKind = LocationSetupFailureCode;

export const LOCATION_GATE_ERROR_COPY: Record<LocationSetupErrorKind, string> = {
  LOCATION_PERMISSION_CHECK_TIMEOUT: "Timed out checking location permission.",
  LOCATION_PERMISSION_CHECK_FAILED: "Could not check location permission.",
  LOCATION_PERMISSION_REQUEST_TIMEOUT: "Timed out requesting location permission.",
  LOCATION_PERMISSION_REQUEST_FAILED: "Could not request location permission.",
  NATIVE_GEOFENCE_HEALTH_TIMEOUT: "Timed out verifying location services.",
  NATIVE_GEOFENCE_HEALTH_FAILED: "Could not verify location services.",
  BACKGROUND_AUTHORIZATION_REQUEST_TIMEOUT: "Timed out requesting complete location access.",
  BACKGROUND_AUTHORIZATION_REQUEST_FAILED: "Could not request complete location access.",
  SECURE_CREDENTIAL_ENROLLMENT_TIMEOUT: "Timed out completing secure location setup.",
  SECURE_CREDENTIAL_ENROLLMENT_FAILED: "Could not complete secure location setup.",
  SECURE_STORE_WRITE_TIMEOUT: "Timed out saving secure location setup.",
  SECURE_STORE_WRITE_FAILED: "Could not save secure location setup.",
  ASSIGNED_LOCATION_REGISTRATION_TIMEOUT: "Timed out finishing location setup.",
  ASSIGNED_LOCATION_REGISTRATION_FAILED: "Could not finish location setup.",
  LOCATION_SETUP_COMPLETION_TIMEOUT: "Timed out completing location setup.",
  LOCATION_SETUP_COMPLETION_FAILED: "Could not complete location setup.",
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
