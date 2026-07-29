/* eslint-disable @typescript-eslint/no-explicit-any */
// Native/mobile FOUNDATION for Attendance (two-zone jobsite geofencing).
//
// This intentionally separates the layers the manager/employee flow needs:
//   1. frontend permission request         -> requestLocationPermissionInteractive()
//   2. native geofence detection            -> the native contract below (STUB)
//   2b. foreground fallback detection       -> startForegroundGeofenceWatch()
//   3. API event ingestion                  -> ingestJobsiteEvent()
//   4. manager review page                  -> app/components/views/JobsiteTimeView
//
// NATIVE INTEGRATION HONESTY: true background region-monitoring (iOS
// CLLocationManager / Android Geofencing API, wired through a Capacitor plugin)
// is NOT implemented — @capacitor/geolocation is not even installed yet. Layer
// 2 below is a contract only: the exact payload shape a future native plugin
// must POST, per job, per zone, per transition. Until that plugin exists,
// startForegroundGeofenceWatch() below provides a real (foreground-only, tab
// must stay open) implementation so the backend + UI can be exercised and
// manually tested end to end today. See PR notes for the native follow-up.
//
// The arrival-confirmation delay and departure-grace-period are NOT enforced
// here — they're enforced server-side (src/lib/jobsite-time/finalizeAttendance.ts)
// against the raw enter/exit transitions this file reports. That keeps the
// timing correct even once a real native plugin (which reports transitions
// immediately, with no client-side waiting) replaces the foreground fallback.

import {
  feetToMeters,
  haversineMeters,
  pickNearestAssignedJob,
  type AssignedJobLocation,
} from "./domain";

export type JobsiteGeofenceTransition = "enter" | "exit";
export type JobsiteGeofenceZone = "wake" | "arrival";

// The single, discrete payload the native geofence receiver must send. We never
// send continuous location — only one event per enter/exit transition.
export type JobsiteGeofenceEvent = {
  jobId: string;
  zone?: JobsiteGeofenceZone;
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

// Attendance location permission lives in a self-contained module (no relative
// imports) so its four outcomes can be unit-tested directly. Re-exported here so
// existing importers of geofence-client keep working.
export {
  checkLocationPermission,
  requestLocationPermissionInteractive,
  resolveLocationGateView,
  mapCapacitorPermission,
  mapGeolocationError,
} from "./locationPermission";
export type {
  LocationPermissionResult,
  LocationPermissionState,
  LocationGateView,
} from "./locationPermission";

// API ingestion (layer 3). Native geofence code AND the web fallback both call
// this. The server validates company/job/assignment/verified-address/schedule
// and creates the timecard + audit event.
export async function ingestJobsiteEvent(
  event: JobsiteGeofenceEvent
): Promise<{ ok: boolean; status: number; error?: string; ignored?: boolean }> {
  try {
    const res = await fetch("/api/jobsite-time/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
    const payload = await res.json().catch(() => null);
    if (res.ok) return { ok: true, status: res.status, ignored: Boolean(payload?.ignored) };
    return { ok: false, status: res.status, error: payload?.error || "Failed to record jobsite event" };
  } catch {
    return { ok: false, status: 0, error: "Network error recording jobsite event" };
  }
}

// ---------------------------------------------------------------------------
// Layer 2b: foreground fallback. Watches the browser/WebView's position and
// reports raw enter/exit transitions per assigned job, per zone — exactly what
// a real native region-monitoring plugin would report, just without OS-level
// background wake-up (the tab/app must stay foregrounded).
// ---------------------------------------------------------------------------

type ZoneState = "outside" | "wake" | "arrival";

export type ForegroundGeofenceOptions = {
  jobs: AssignedJobLocation[];
  wakeRadiusMeters: number;
  arrivalRadiusFeet: number;
  onEvent?: (event: JobsiteGeofenceEvent, result: { ok: boolean; ignored?: boolean; error?: string }) => void;
  onError?: (error: GeolocationPositionError) => void;
};

function classifyZone(distanceMeters: number, wakeRadiusMeters: number, arrivalRadiusFeet: number): ZoneState {
  if (distanceMeters <= feetToMeters(arrivalRadiusFeet)) return "arrival";
  if (distanceMeters <= wakeRadiusMeters) return "wake";
  return "outside";
}

// Starts a foreground watch. Only ever tracks the SINGLE nearest verified
// assigned job at a time (never more than one "current" geofence), which is
// how region-monitoring based native geofencing behaves in practice and keeps
// double-clock-in impossible on the client side too.
export function startForegroundGeofenceWatch(options: ForegroundGeofenceOptions): { stop: () => void } {
  let lastJobId: string | null = null;
  let lastZone: ZoneState = "outside";
  let watchId: number | null = null;

  if (typeof navigator === "undefined" || !navigator.geolocation?.watchPosition) {
    return { stop: () => {} };
  }

  const handlePosition = (position: GeolocationPosition) => {
    const point = { lat: position.coords.latitude, lng: position.coords.longitude };
    const nearest = pickNearestAssignedJob(options.jobs, point);
    const occurredAt = new Date(position.timestamp).toISOString();
    const accuracyMeters = position.coords.accuracy ?? null;

    if (!nearest) {
      if (lastJobId && lastZone !== "outside") {
        emit({
          jobId: lastJobId,
          zone: lastZone === "arrival" ? "arrival" : "wake",
          transition: "exit",
          occurredAt,
          latitude: point.lat,
          longitude: point.lng,
          accuracyMeters,
        });
      }
      lastJobId = null;
      lastZone = "outside";
      return;
    }

    const zone = classifyZone(nearest.distanceMeters, options.wakeRadiusMeters, options.arrivalRadiusFeet);
    const jobId = nearest.job.jobId;

    if (jobId !== lastJobId) {
      // Switched which job is nearest — exit the old one (if inside a zone),
      // then evaluate the new one fresh.
      if (lastJobId && lastZone !== "outside") {
        emit({
          jobId: lastJobId,
          zone: lastZone === "arrival" ? "arrival" : "wake",
          transition: "exit",
          occurredAt,
          latitude: point.lat,
          longitude: point.lng,
          accuracyMeters,
        });
      }
      lastJobId = jobId;
      lastZone = "outside";
    }

    if (zone === lastZone) return;

    // Wake -> arrival: only ENTER arrival (already inside wake). Arrival ->
    // wake: only EXIT arrival. Outside <-> wake: enter/exit wake.
    if (zone === "arrival" && lastZone !== "arrival") {
      emit({ jobId, zone: "arrival", transition: "enter", occurredAt, latitude: point.lat, longitude: point.lng, accuracyMeters });
    } else if (zone !== "arrival" && lastZone === "arrival") {
      emit({ jobId, zone: "arrival", transition: "exit", occurredAt, latitude: point.lat, longitude: point.lng, accuracyMeters });
    }
    if (zone !== "outside" && lastZone === "outside") {
      emit({ jobId, zone: "wake", transition: "enter", occurredAt, latitude: point.lat, longitude: point.lng, accuracyMeters });
    } else if (zone === "outside" && lastZone !== "outside") {
      emit({ jobId, zone: "wake", transition: "exit", occurredAt, latitude: point.lat, longitude: point.lng, accuracyMeters });
    }
    lastZone = zone;
  };

  const emit = (event: JobsiteGeofenceEvent) => {
    ingestJobsiteEvent(event).then((result) => options.onEvent?.(event, result));
  };

  watchId = navigator.geolocation.watchPosition(
    handlePosition,
    (err) => options.onError?.(err),
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 }
  );

  return {
    stop: () => {
      if (watchId !== null && navigator.geolocation?.clearWatch) {
        navigator.geolocation.clearWatch(watchId);
      }
    },
  };
}

// Fetches the current user's assigned jobs (with verified coordinates when
// available) for the foreground watcher / status card.
export async function fetchAssignedJobsRequired(): Promise<
  Array<AssignedJobLocation & { name?: string }>
> {
  const res = await fetch("/api/jobsite-time/assigned-jobs", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load assigned locations");
  const json = await res.json().catch(() => null);
  if (!Array.isArray(json?.items)) throw new Error("Assigned locations response was invalid");
  return json.items.map((j: any) => ({
    jobId: String(j.jobId),
    lat: j.lat ?? null,
    lng: j.lng ?? null,
    addressVerified: Boolean(j.addressVerified),
    name: j.name ?? "Job",
  }));
}

export async function fetchAssignedJobs(): Promise<Array<AssignedJobLocation & { name?: string }>> {
  try {
    return await fetchAssignedJobsRequired();
  } catch {
    return [];
  }
}

export { haversineMeters };
