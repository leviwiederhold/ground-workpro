/* eslint-disable @typescript-eslint/no-explicit-any */
// Client runtime for the background-location model. Best-effort by design: the
// @capacitor/geolocation plugin exposes foreground grant but cannot reliably
// report the "Always"/precise distinction, so those dimensions are reported as
// "unknown"/null rather than fabricated. The server persists whatever we can
// observe; the OS remains the source of truth.

import {
  mapCapacitorPermission,
  requestLocationPermissionInteractive,
} from "../jobsite-time/locationPermission.ts";
import type {
  LocationPermissionSnapshot,
  PermissionLevel,
  StoredLocationPermission,
} from "./backgroundLocation.ts";
import type { NativeGeofenceHealth } from "./nativeGeofence.ts";

const LOCAL_KEY = "attendance.locationPermission.v1";

function getCapacitor(): any | null {
  if (typeof window === "undefined") return null;
  return (window as any).Capacitor ?? null;
}

export function detectPlatform(): LocationPermissionSnapshot["platform"] {
  const cap = getCapacitor();
  const p = cap?.getPlatform?.();
  if (p === "ios" || p === "android") return p;
  if (typeof window !== "undefined") return "web";
  return "unknown";
}

async function loadGeolocation(): Promise<any | null> {
  const cap = getCapacitor();
  if (!cap?.isNativePlatform?.()) return null;
  try {
    const mod: any = await import("@capacitor/geolocation");
    return mod?.Geolocation ?? null;
  } catch {
    return null;
  }
}

/**
 * Read the current permission snapshot. Foreground comes from the plugin;
 * background/precise/services are "unknown"/null on native (not observable via
 * this plugin) and on web are derived from the browser Permissions API.
 */
export async function readLocationPermissionSnapshot(): Promise<LocationPermissionSnapshot> {
  const platform = detectPlatform();
  const capturedAt = new Date().toISOString();
  const geo = await loadGeolocation();

  if (geo?.checkPermissions) {
    let foreground: PermissionLevel = "unknown";
    try {
      foreground = mapCapacitorPermission(await geo.checkPermissions()) as PermissionLevel;
    } catch {
      foreground = "unknown";
    }
    return {
      // The device-wide toggle and Always/precise state are not exposed by the
      // plugin; leave them unknown so the app never over-claims readiness.
      locationServicesEnabled: null,
      foreground,
      background: "unknown",
      precise: null,
      platform,
      capturedAt,
    };
  }

  // Web fallback.
  let foreground: PermissionLevel = "prompt";
  try {
    const status = await (navigator as any)?.permissions?.query?.({ name: "geolocation" });
    if (status?.state === "granted" || status?.state === "denied" || status?.state === "prompt") {
      foreground = status.state;
    }
  } catch {
    foreground = typeof navigator !== "undefined" && navigator.geolocation ? "prompt" : "unavailable";
  }
  return {
    locationServicesEnabled: null,
    foreground,
    background: "unavailable", // no background geofencing on the web
    precise: null,
    platform,
    capturedAt,
  };
}

/**
 * Request location access from the user gesture. Surfaces the OS dialog for
 * foreground; on native, "Always"/precise are elevated by the OS in Settings,
 * so after the request we re-read what we can and let the UI direct the user to
 * Settings for the background upgrade if needed.
 */
export async function requestBackgroundLocation(): Promise<LocationPermissionSnapshot> {
  try {
    await requestLocationPermissionInteractive();
  } catch {
    // Ignore — the follow-up read reflects the resulting state.
  }
  return readLocationPermissionSnapshot();
}

export function loadStoredLocationPermission(): StoredLocationPermission | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    return raw ? (JSON.parse(raw) as StoredLocationPermission) : null;
  } catch {
    return null;
  }
}

function cacheLocally(stored: StoredLocationPermission) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(stored));
  } catch {
    // Non-fatal: the server copy remains authoritative.
  }
}

/** Persist the snapshot locally (avoid re-prompting) and on the server. */
export async function persistLocationPermission(
  snapshot: LocationPermissionSnapshot,
  opts: {
    onboardingCompleted?: boolean;
    setupComplete?: boolean;
    nativeReadiness?: {
      supported: boolean;
      healthy: boolean;
      backgroundRefreshEnabled: boolean | null;
      hasSecureCredential: boolean;
      requiredRegionIds: string[];
      registeredRegionIds: string[];
    };
  } = {}
): Promise<void> {
  const prior = loadStoredLocationPermission();
  const completed = opts.setupComplete ?? opts.onboardingCompleted;
  const onboardingCompletedAt = completed === true
    ? new Date().toISOString()
    : completed === false
      ? null
    : prior?.onboardingCompletedAt ?? null;
  cacheLocally({ onboardingCompletedAt, snapshot });

  try {
    await fetch("/api/attendance/location-permission", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locationServicesEnabled: snapshot.locationServicesEnabled,
        foreground: snapshot.foreground,
        background: snapshot.background,
        precise: snapshot.precise,
        platform: snapshot.platform,
        onboardingCompleted: Boolean(opts.onboardingCompleted),
        setupComplete: opts.setupComplete,
        nativeServiceSupported: opts.nativeReadiness?.supported,
        nativeServiceHealthy: opts.nativeReadiness?.healthy,
        backgroundRefreshEnabled: opts.nativeReadiness?.backgroundRefreshEnabled,
        nativeHasSecureCredential: opts.nativeReadiness?.hasSecureCredential,
        requiredRegionIds: opts.nativeReadiness?.requiredRegionIds,
        registeredRegionIds: opts.nativeReadiness?.registeredRegionIds,
      }),
    });
  } catch {
    // Offline is fine — the local cache still prevents re-prompting.
  }
}

/** Convert the same native health read used by the gate into its server report. */
export function nativeHealthToPermissionSnapshot(
  health: Pick<
    NativeGeofenceHealth,
    "authorizationStatus" | "locationServicesEnabled" | "preciseLocation"
  >,
  capturedAt: string = new Date().toISOString(),
): LocationPermissionSnapshot {
  const foreground =
    health.authorizationStatus === "authorized_always" ||
    health.authorizationStatus === "authorized_when_in_use"
      ? "granted"
      : health.authorizationStatus === "not_determined"
        ? "prompt"
        : health.authorizationStatus === "denied" ||
            health.authorizationStatus === "restricted"
          ? "denied"
          : "unknown";
  const background =
    health.authorizationStatus === "authorized_always"
      ? "granted"
      : health.authorizationStatus === "not_determined" ||
          health.authorizationStatus === "authorized_when_in_use"
        ? "prompt"
        : health.authorizationStatus === "denied" ||
            health.authorizationStatus === "restricted"
          ? "denied"
          : "unknown";
  return {
    locationServicesEnabled: health.locationServicesEnabled,
    foreground,
    background,
    precise: health.preciseLocation,
    platform: "ios",
    capturedAt,
  };
}

/**
 * Best-effort server synchronization after a definitive live native check.
 * Transient bridge failures never call this, so they cannot flip a configured
 * employee to "Not set up".
 */
export async function persistNativeAttendanceReadiness(
  health: Pick<
    NativeGeofenceHealth,
    | "supported"
    | "authorizationStatus"
    | "locationServicesEnabled"
    | "backgroundRefreshEnabled"
    | "preciseLocation"
    | "hasCredential"
  >,
  setupComplete: boolean,
  regions: { requiredRegionIds: string[]; registeredRegionIds: string[] },
): Promise<void> {
  await persistLocationPermission(nativeHealthToPermissionSnapshot(health), {
    setupComplete,
    nativeReadiness: {
      supported: health.supported,
      healthy:
        health.supported &&
        health.locationServicesEnabled === true &&
        health.backgroundRefreshEnabled === true,
      backgroundRefreshEnabled: health.backgroundRefreshEnabled,
      hasSecureCredential: health.hasCredential,
      requiredRegionIds: regions.requiredRegionIds,
      registeredRegionIds: regions.registeredRegionIds,
    },
  });
}
