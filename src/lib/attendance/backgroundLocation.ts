// Native background-location permission model for automatic attendance.
//
// Four independent dimensions the OS exposes, kept SEPARATE because they fail
// (and are fixed) differently:
//   - locationServicesEnabled : the device-wide Location Services toggle
//   - foreground              : "While Using the App"
//   - background              : "Always" (required for background geofences)
//   - precise                 : precise vs approximate location
//
// The OS owns permission behavior; this module only models and interprets the
// current state so the app can (a) onboard once, (b) detect revocation, and
// (c) never claim automatic attendance is active when background is missing.

export type PermissionLevel = "granted" | "denied" | "prompt" | "unavailable" | "unknown";

export type LocationPermissionSnapshot = {
  locationServicesEnabled: boolean | null; // null = unknown
  foreground: PermissionLevel;
  background: PermissionLevel;
  precise: boolean | null; // null = unknown
  platform: "ios" | "android" | "web" | "unknown";
  capturedAt: string; // ISO
};

export type StoredLocationPermission = {
  onboardingCompletedAt: string | null;
  snapshot: LocationPermissionSnapshot | null;
};

/**
 * Background geofencing is only truly ready when Location Services are on,
 * foreground AND background are granted, and precise location is not explicitly
 * off. Unknown precise is tolerated (many devices don't report it); unknown
 * background is NOT treated as ready — we never over-claim.
 */
export function isBackgroundReady(snapshot: LocationPermissionSnapshot | null): boolean {
  if (!snapshot) return false;
  if (snapshot.locationServicesEnabled === false) return false;
  if (snapshot.foreground !== "granted") return false;
  if (snapshot.background !== "granted") return false;
  if (snapshot.precise === false) return false;
  return true;
}

/**
 * The server-visible equivalent of the native gate's live completion decision.
 *
 * `onboardingCompletedAt` is written only after the device has verified native
 * health, its secure credential, and every assigned region. The permission
 * dimensions and active server credential are checked separately so this
 * cannot degrade into a single stale boolean.
 */
export function isReportedAttendanceSetupComplete(params: {
  snapshot: LocationPermissionSnapshot | null;
  onboardingCompletedAt: string | null;
  hasActiveCredential: boolean;
}): boolean {
  const platform = params.snapshot?.platform;
  return (
    (platform === "ios" || platform === "android") &&
    isBackgroundReady(params.snapshot) &&
    Boolean(params.onboardingCompletedAt) &&
    params.hasActiveCredential
  );
}

/**
 * The app must NEVER show automatic attendance as active without background
 * permission. This is the single guard other surfaces should consult.
 */
export function automaticAttendanceClaimable(snapshot: LocationPermissionSnapshot | null): boolean {
  return isBackgroundReady(snapshot);
}

/**
 * Whether onboarding should prompt now. Prompt when it has never completed, or
 * when a previously-ready setup has regressed (revoked/downgraded). Do NOT
 * re-prompt when already background-ready — the app avoids asking on every
 * launch once access is granted.
 */
export function shouldPromptOnboarding(
  stored: StoredLocationPermission | null,
  current: LocationPermissionSnapshot | null
): boolean {
  if (isBackgroundReady(current)) return false;
  if (!stored || !stored.onboardingCompletedAt) return true;
  // Previously completed but no longer ready → a revocation/downgrade; re-prompt.
  return true;
}

export type PermissionRegression =
  | "location_services_disabled"
  | "foreground_revoked"
  | "background_revoked"
  | "precise_disabled";

/**
 * Compare a previously-ready snapshot with the current one and report every
 * dimension that regressed. Empty array = no regression detected.
 */
export function detectRegressions(
  previous: LocationPermissionSnapshot | null,
  current: LocationPermissionSnapshot | null
): PermissionRegression[] {
  if (!previous || !current) return [];
  const regressions: PermissionRegression[] = [];
  if (previous.locationServicesEnabled !== false && current.locationServicesEnabled === false) {
    regressions.push("location_services_disabled");
  }
  if (previous.foreground === "granted" && current.foreground !== "granted") {
    regressions.push("foreground_revoked");
  }
  if (previous.background === "granted" && current.background !== "granted") {
    regressions.push("background_revoked");
  }
  if (previous.precise !== false && current.precise === false) {
    regressions.push("precise_disabled");
  }
  return regressions;
}

// The single actionable status the employee UI should show. "settings_required"
// means the fix lives in the OS Settings app (the app cannot grant it).
export type LocationOnboardingStatus =
  | "ready"
  | "needs_onboarding"
  | "settings_required"
  | "services_disabled";

export function resolveOnboardingStatus(
  stored: StoredLocationPermission | null,
  current: LocationPermissionSnapshot | null
): LocationOnboardingStatus {
  if (isBackgroundReady(current)) return "ready";
  if (current?.locationServicesEnabled === false) return "services_disabled";
  // Denied (not just "prompt") means the in-app request won't surface a dialog
  // anymore — the user must change it in Settings.
  const hardDenied =
    current?.foreground === "denied" || current?.background === "denied" || current?.precise === false;
  if (hardDenied) return "settings_required";
  if (!stored?.onboardingCompletedAt) return "needs_onboarding";
  // Completed before but state regressed to a promptable level.
  return "needs_onboarding";
}

export const LOCATION_ONBOARDING_STATUS_MESSAGE: Record<LocationOnboardingStatus, string> = {
  ready: "Automatic attendance is set up.",
  needs_onboarding: "Finish location setup to enable automatic attendance.",
  settings_required:
    "Background location is off. Open Settings and set Location to “Always” with Precise on to enable automatic attendance.",
  services_disabled: "Location Services are off. Turn them on in Settings to enable automatic attendance.",
};
