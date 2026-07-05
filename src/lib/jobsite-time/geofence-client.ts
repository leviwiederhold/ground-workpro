/* eslint-disable @typescript-eslint/no-explicit-any */
// Native/mobile FOUNDATION for Automatic Jobsite Time.
//
// This intentionally separates the four layers the manager/employee flow needs:
//   1. frontend permission request         -> requestJobsiteLocationPermission()
//   2. native geofence detection            -> the native contract below (STUB)
//   3. API event ingestion                  -> ingestJobsiteEvent()
//   4. manager review page                  -> app/components/views/JobsiteTimeView
//
// Full background geofencing requires a native plugin (e.g. Capacitor
// background geolocation / iOS CLLocationManager region monitoring). That native
// layer is NOT bundled here — instead we define the exact event payload the
// native code must POST, and provide a browser-safe foreground fallback so the
// backend + UI can be exercised end to end today.

export type JobsiteGeofenceTransition = "enter" | "exit";

// The single, discrete payload the native geofence receiver must send. We never
// send continuous location — only one event per enter/exit transition.
export type JobsiteGeofenceEvent = {
  jobId: string;
  transition: JobsiteGeofenceTransition;
  occurredAt: string; // ISO
  // Coarse coordinates only, optional. Server rounds/omits as configured.
  latitude?: number | null;
  longitude?: number | null;
  accuracyMeters?: number | null;
  source?: "jobsite_auto" | "manual";
};

type CapacitorLike = {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, any>;
};

function getCapacitor(): CapacitorLike | null {
  if (typeof window === "undefined") return null;
  return (window as any).Capacitor ?? null;
}

export function isNativeGeofenceAvailable(): boolean {
  const cap = getCapacitor();
  return Boolean(cap?.isNativePlatform?.() && cap?.Plugins?.Geolocation);
}

// Frontend permission request. On native, defers to the Capacitor Geolocation
// plugin; on web, uses the standard Geolocation permission prompt. Returns a
// coarse status the UI can display.
export async function requestJobsiteLocationPermission(): Promise<
  "granted" | "denied" | "unavailable" | "prompt"
> {
  const cap = getCapacitor();
  const geo = cap?.Plugins?.Geolocation;
  if (geo?.requestPermissions) {
    try {
      const res = await geo.requestPermissions();
      const state = String(res?.location ?? res?.coarseLocation ?? "").toLowerCase();
      if (state === "granted") return "granted";
      if (state === "denied") return "denied";
      return "prompt";
    } catch {
      return "unavailable";
    }
  }
  if (typeof navigator !== "undefined" && navigator.permissions?.query) {
    try {
      const status = await navigator.permissions.query({ name: "geolocation" as PermissionName });
      return (status.state as any) ?? "prompt";
    } catch {
      return "unavailable";
    }
  }
  if (typeof navigator !== "undefined" && navigator.geolocation) return "prompt";
  return "unavailable";
}

// API ingestion (layer 3). Native geofence code AND the web fallback both call
// this. The server validates company/job/assignment/shift window and creates
// the timecard + audit event.
export async function ingestJobsiteEvent(
  event: JobsiteGeofenceEvent
): Promise<{ ok: boolean; status: number; error?: string }> {
  try {
    const res = await fetch("/api/jobsite-time/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
    if (res.ok) return { ok: true, status: res.status };
    const payload = await res.json().catch(() => null);
    return { ok: false, status: res.status, error: payload?.error || "Failed to record jobsite event" };
  } catch {
    return { ok: false, status: 0, error: "Network error recording jobsite event" };
  }
}
