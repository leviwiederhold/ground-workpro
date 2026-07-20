/* eslint-disable @typescript-eslint/no-explicit-any */
// Best-effort client collector that assembles an AttendanceDiagnosticsInput from
// whatever signals are available in the current runtime. Every source is guarded
// so the collector never throws — an unavailable signal becomes null/"unknown",
// which is itself diagnostic (honest about what the app can and cannot see).
//
// It deliberately captures only ONE current location fix and never persists a
// location history, keeping the snapshot privacy-safe.

import {
  buildAttendanceDiagnostics,
  type AttendanceDiagnostics,
  type AttendanceDiagnosticsInput,
  type DiagnosticsAssignedJob,
  type PermissionState,
} from "./attendanceDiagnostics.ts";
import { checkLocationPermission } from "./locationPermission.ts";
import { isNativeGeofenceAvailable } from "./geofence-client.ts";

async function fetchJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

async function getOneLocationFix(): Promise<AttendanceDiagnosticsInput["location"]> {
  if (typeof navigator === "undefined" || !navigator.geolocation?.getCurrentPosition) return null;
  return new Promise((resolve) => {
    let settled = false;
    const done = (value: AttendanceDiagnosticsInput["location"]) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        done({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyMeters: pos.coords.accuracy ?? null,
          capturedAt: new Date().toISOString(),
        }),
      () => done(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
    // Hard stop in case the callback never fires.
    setTimeout(() => done(null), 12000);
  });
}

export type CollectDiagnosticsOptions = {
  employeeId?: string | null;
  // The employee's scheduled shift for today, if the caller already knows it.
  schedule?: { startAt: string | null; endAt: string | null } | null;
  attendanceStatus?: string | null;
};

/**
 * Gather a live diagnostics snapshot. Pulls the assigned job + geofence settings
 * from the existing attendance endpoints and reads one location fix + the
 * foreground permission state. Background/precise/location-services states are
 * reported as "unknown"/null unless a native bridge exposes them — the collector
 * never fabricates a granted state it cannot verify.
 */
export async function collectAttendanceDiagnostics(
  options: CollectDiagnosticsOptions = {}
): Promise<AttendanceDiagnostics> {
  const [assignedPayload, settingsPayload, foregroundState, location] = await Promise.all([
    fetchJson("/api/jobsite-time/assigned-jobs"),
    fetchJson("/api/jobsite-time/settings"),
    checkLocationPermission().catch(() => "unknown" as const),
    getOneLocationFix(),
  ]);

  const items: any[] = Array.isArray(assignedPayload?.items) ? assignedPayload.items : [];
  const firstVerified = items.find((j) => j?.addressVerified) ?? items[0] ?? null;
  const assignedJob: DiagnosticsAssignedJob | null = firstVerified
    ? {
        jobId: String(firstVerified.jobId ?? ""),
        name: String(firstVerified.name ?? "Job"),
        lat: firstVerified.lat ?? null,
        lng: firstVerified.lng ?? null,
        addressVerified: Boolean(firstVerified.addressVerified),
      }
    : null;

  const settings = settingsPayload?.item ?? {};
  const geofenceRadiusFeet =
    typeof settings.arrivalRadiusFeet === "number" ? settings.arrivalRadiusFeet : null;
  const wakeRadiusMeters =
    typeof settings.wakeRadiusMeters === "number" ? settings.wakeRadiusMeters : null;
  const monitoringLeadMinutes =
    typeof settings.earlyArrivalWindowMinutes === "number"
      ? settings.earlyArrivalWindowMinutes
      : typeof settings.monitoringLeadMinutes === "number"
        ? settings.monitoringLeadMinutes
        : null;

  const foreground = (foregroundState as PermissionState) ?? "unknown";
  const nativeGeofenceSupported = isNativeGeofenceAvailable();

  const input: AttendanceDiagnosticsInput = {
    employeeId: options.employeeId ?? null,
    assignedJob,
    geofenceRadiusFeet,
    wakeRadiusMeters,
    monitoringLeadMinutes,
    schedule: options.schedule ?? null,
    permissions: {
      foreground,
      // Not separately observable without a native bridge; report honestly.
      background: nativeGeofenceSupported ? "unknown" : "unavailable",
      preciseLocation: null,
      locationServicesEnabled: foreground === "unavailable" ? false : null,
    },
    location,
    // Native region-monitoring registry is not yet exposed to the web layer.
    registeredGeofences: [],
    lastGeofenceEntryAt: null,
    lastGeofenceExitAt: null,
    lastSuccessfulSyncAt: null,
    attendanceStatus: options.attendanceStatus ?? null,
    nativeGeofenceSupported,
  };

  return buildAttendanceDiagnostics(input);
}
