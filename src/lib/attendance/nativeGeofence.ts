/* eslint-disable @typescript-eslint/no-explicit-any */
// Bridge to the native jobsite geofence plugin (iOS CoreLocation region
// monitoring / Android GeofencingClient).
//
// IMPORTANT — remote-URL shell: the iOS/Android app loads a deployed site, so
// while the app is backgrounded or terminated NO web JS runs. True background
// arrival/departure detection therefore lives in NATIVE code (see the plugin
// reference under ios/ and android/). This module is the JS side of the
// contract: it registers the region set the native layer should monitor, reads
// back what is registered (for diagnostics/admin), and — when the app is in the
// foreground — forwards any transition the native plugin emits to the same
// server pipeline the foreground fallback uses.
//
// Everything here is a safe no-op when the native plugin is absent (web, or a
// native build that hasn't bundled the plugin yet), so the app keeps working via
// the foreground watch.

export type GeofenceZone = "arrival" | "wake";

export type GeofenceRegion = {
  identifier: string; // stable id: `${jobId}:${zone}`
  jobId: string;
  zone: GeofenceZone;
  latitude: number;
  longitude: number;
  radiusMeters: number;
};

export type GeofenceTransitionEvent = {
  identifier: string;
  jobId: string;
  zone: GeofenceZone;
  transition: "enter" | "exit";
  latitude?: number | null;
  longitude?: number | null;
  accuracyMeters?: number | null;
  occurredAt: string; // ISO
};

export type GeofenceAuthorizationEvent = {
  authorized: boolean;
  authorizationStatus: NativeGeofenceHealth["authorizationStatus"];
};

// Health/registration status the native layer reports up to the web layer, so
// the app (and diagnostics) can confirm monitoring is actually live.
export type NativeGeofenceHealth = {
  supported: boolean;
  authorized: boolean; // background location authorized natively
  authorizationStatus:
    | "not_determined"
    | "restricted"
    | "denied"
    | "authorized_when_in_use"
    | "authorized_always"
    | "unknown";
  locationServicesEnabled: boolean | null;
  // iOS does not relaunch the app for region notifications when Background App
  // Refresh is disabled globally or for the app.
  backgroundRefreshEnabled: boolean | null;
  preciseLocation: boolean | null;
  registeredCount: number;
  lastEventAt: string | null;
  lastEventTransition: "enter" | "exit" | null;
  lastError: string | null;
  pendingQueuedCount: number; // native offline queue depth
  // Whether a device credential is present in the Keychain/Keystore. Without
  // one the native layer cannot authenticate a background submission, so
  // monitoring is NOT actually working however healthy everything else looks.
  hasCredential: boolean;
};

// The native plugin contract. A native implementation registers under this name.
export interface JobsiteGeofencePlugin {
  register(options: { regions: GeofenceRegion[] }): Promise<void>;
  removeAll(): Promise<void>;
  getRegistered(): Promise<{ regions: GeofenceRegion[] }>;
  getHealth(): Promise<NativeGeofenceHealth>;
  requestAlwaysAuthorization(): Promise<void>;
  addListener(
    eventName: "geofenceTransition",
    listener: (event: GeofenceTransitionEvent) => void
  ): { remove: () => void } | Promise<{ remove: () => void }>;
  addListener(
    eventName: "geofenceAuthorizationChanged",
    listener: (event: GeofenceAuthorizationEvent) => void
  ): { remove: () => void } | Promise<{ remove: () => void }>;
}

export async function onGeofenceAuthorizationChanged(
  handler: (event: GeofenceAuthorizationEvent) => void,
): Promise<() => void> {
  const plugin = getPlugin();
  if (!plugin) return () => {};
  const handle = await plugin.addListener("geofenceAuthorizationChanged", handler);
  return () => handle.remove();
}

function getPlugin(): JobsiteGeofencePlugin | null {
  if (typeof window === "undefined") return null;
  const cap = (window as any).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  return (cap.Plugins?.JobsiteGeofence as JobsiteGeofencePlugin | undefined) ?? null;
}

export function isNativeGeofenceAvailable(): boolean {
  return getPlugin() !== null;
}

/**
 * Build the region set for ONE job: the small "arrival" region (the clock-in
 * boundary) and the wide "wake" region (starts closer monitoring). iOS caps
 * monitored regions at 20, so callers register only the nearest assigned job.
 */
export function buildJobsiteRegions(
  job: { jobId: string; lat: number | null; lng: number | null; addressVerified: boolean },
  arrivalRadiusMeters: number,
  wakeRadiusMeters: number
): GeofenceRegion[] {
  if (!job.addressVerified || job.lat === null || job.lng === null) return [];
  const base = { jobId: String(job.jobId), latitude: job.lat, longitude: job.lng };
  const arrival: GeofenceRegion = {
    identifier: `${job.jobId}:arrival`,
    zone: "arrival",
    radiusMeters: arrivalRadiusMeters,
    ...base,
  };

  // The wake region is only useful when it is genuinely wider than the
  // attendance boundary. Production had a legacy 5,280 ft arrival radius and a
  // 1,609 m wake radius — effectively two identical Core Location regions.
  // iOS delivered the wake enter but not the arrival enter, then delivered both
  // exits together. Collapsing that redundant pair preserves the configured
  // arrival boundary and guarantees the one entry callback is actionable.
  if (wakeRadiusMeters <= arrivalRadiusMeters + 1) return [arrival];

  return [
    arrival,
    { identifier: `${job.jobId}:wake`, zone: "wake", radiusMeters: wakeRadiusMeters, ...base },
  ];
}

/** Register a region set natively. No-op (returns false) when unavailable. */
export async function registerGeofences(regions: GeofenceRegion[]): Promise<boolean> {
  const plugin = getPlugin();
  if (!plugin) return false;
  try {
    // `register` owns reconciliation of the desired set. Removing everything
    // first created a real zero-region window on every launch/focus refresh;
    // the concurrent startup readiness check saw that gap and raised the
    // location gate again for an otherwise-complete device.
    await plugin.register({ regions });
    return true;
  } catch {
    return false;
  }
}

export async function getRegisteredGeofences(): Promise<GeofenceRegion[]> {
  const plugin = getPlugin();
  if (!plugin) return [];
  try {
    return (await plugin.getRegistered()).regions ?? [];
  } catch {
    return [];
  }
}

/** Strict read used by startup readiness checks; bridge errors are not "zero regions". */
export async function requireRegisteredGeofencesRead(): Promise<GeofenceRegion[]> {
  const plugin = getPlugin();
  if (!plugin) throw new Error("JobsiteGeofence native bridge unavailable");
  const result = await plugin.getRegistered();
  if (!Array.isArray(result?.regions)) {
    throw new Error("native location service returned an invalid region list");
  }
  return result.regions;
}

const UNAVAILABLE_HEALTH: NativeGeofenceHealth = {
  supported: false,
  authorized: false,
  authorizationStatus: "unknown",
  locationServicesEnabled: null,
  backgroundRefreshEnabled: null,
  preciseLocation: null,
  registeredCount: 0,
  lastEventAt: null,
  lastEventTransition: null,
  lastError: null,
  pendingQueuedCount: 0,
  hasCredential: false,
};

/** Native registration + health status, for the web layer / diagnostics. */
export async function getNativeGeofenceHealth(): Promise<NativeGeofenceHealth> {
  const plugin = getPlugin();
  if (!plugin) return UNAVAILABLE_HEALTH;
  try {
    const health = await plugin.getHealth();
    // Older native builds predate hasCredential. Default it to FALSE rather
    // than true: an unknown credential must never let the UI claim monitoring
    // is active.
    return { ...UNAVAILABLE_HEALTH, ...health, supported: true, hasCredential: health.hasCredential === true };
  } catch (e) {
    return { ...UNAVAILABLE_HEALTH, supported: true, lastError: e instanceof Error ? e.message : "health check failed" };
  }
}

/**
 * Diagnostic/required variant used by native setup. Unlike the dashboard-safe
 * helper above, this throws when the app-target plugin was not registered or
 * when the bridge call rejects. That distinction is essential on TestFlight:
 * returning an "unavailable" health-shaped value hid a broken native shell and
 * made the gate report only a generic enrollment failure.
 */
export async function requireNativeGeofenceHealth(): Promise<NativeGeofenceHealth> {
  const plugin = getPlugin();
  if (!plugin) throw new Error("JobsiteGeofence native bridge unavailable");
  const health = await plugin.getHealth();
  if (health?.supported !== true) {
    throw new Error(health?.lastError || "native geofence service is not supported");
  }
  return {
    ...UNAVAILABLE_HEALTH,
    ...health,
    supported: true,
    hasCredential: health.hasCredential === true,
  };
}

/** Ask iOS to elevate an existing foreground grant to Always authorization. */
export async function requestNativeAlwaysAuthorization(): Promise<void> {
  const plugin = getPlugin();
  if (!plugin?.requestAlwaysAuthorization) {
    throw new Error("native location authorization bridge unavailable");
  }
  await plugin.requestAlwaysAuthorization();
}

/**
 * Register and read back the exact required region set. A successful bridge
 * call is not enough: setup only completes when Core Location reports every
 * assigned identifier as monitored.
 */
export async function requireRegisteredGeofences(
  regions: GeofenceRegion[],
): Promise<{ requiredRegionIds: string[]; registeredRegionIds: string[] }> {
  const plugin = getPlugin();
  if (!plugin) throw new Error("native location service unavailable");
  if (regions.length === 0) throw new Error("no assigned location regions are available");

  // Native registration is an idempotent desired-state reconciliation. Never
  // introduce an empty monitoring gap merely to validate an already-correct
  // setup.
  await plugin.register({ regions });
  const registered = (await plugin.getRegistered()).regions ?? [];
  const requiredRegionIds = regions.map((region) => region.identifier).sort();
  const registeredRegionIds = registered.map((region) => region.identifier).sort();
  const registeredSet = new Set(registeredRegionIds);
  if (!requiredRegionIds.every((identifier) => registeredSet.has(identifier))) {
    throw new Error("assigned location regions were not registered");
  }
  return { requiredRegionIds, registeredRegionIds };
}

/**
 * Subscribe to native transition events for the time the app is in the
 * foreground (background transitions are POSTed by the native layer directly).
 * Returns an unsubscribe function; no-op when the plugin is absent.
 */
export async function onGeofenceTransition(
  handler: (event: GeofenceTransitionEvent) => void
): Promise<() => void> {
  const plugin = getPlugin();
  if (!plugin) return () => {};
  try {
    const handle = await plugin.addListener("geofenceTransition", handler);
    return () => {
      try {
        handle.remove();
      } catch {
        /* ignore */
      }
    };
  } catch {
    return () => {};
  }
}
