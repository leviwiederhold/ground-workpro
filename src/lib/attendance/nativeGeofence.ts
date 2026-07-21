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

// The native plugin contract. A native implementation registers under this name.
export interface JobsiteGeofencePlugin {
  register(options: { regions: GeofenceRegion[] }): Promise<void>;
  removeAll(): Promise<void>;
  getRegistered(): Promise<{ regions: GeofenceRegion[] }>;
  addListener(
    eventName: "geofenceTransition",
    listener: (event: GeofenceTransitionEvent) => void
  ): { remove: () => void } | Promise<{ remove: () => void }>;
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
  return [
    { identifier: `${job.jobId}:arrival`, zone: "arrival", radiusMeters: arrivalRadiusMeters, ...base },
    { identifier: `${job.jobId}:wake`, zone: "wake", radiusMeters: wakeRadiusMeters, ...base },
  ];
}

/** Register a region set natively. No-op (returns false) when unavailable. */
export async function registerGeofences(regions: GeofenceRegion[]): Promise<boolean> {
  const plugin = getPlugin();
  if (!plugin) return false;
  try {
    await plugin.removeAll();
    if (regions.length > 0) await plugin.register({ regions });
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
