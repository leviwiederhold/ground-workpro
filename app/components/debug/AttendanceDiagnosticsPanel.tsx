"use client";

// Internal attendance diagnostics panel. Renders the structured snapshot that
// explains EXACTLY why automatic attendance is (in)active — assignment, coords,
// permissions, monitoring window, geofence registration, distance, and the
// reason code. Intended for admins / development only; the caller decides
// visibility via the `enabled` prop (e.g. platform admin or a debug flag).
//
// Collecting a snapshot reads one live location fix, so it is only done on an
// explicit button press — never automatically on mount.

import { useState } from "react";
import {
  AUTO_ATTENDANCE_INACTIVE_REASON_LABEL,
  type AttendanceDiagnostics,
} from "@/lib/jobsite-time/attendanceDiagnostics";
import {
  collectAttendanceDiagnostics,
  type CollectDiagnosticsOptions,
} from "@/lib/jobsite-time/collectAttendanceDiagnostics";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-gray-100 py-1 text-xs">
      <span className="text-gray-500">{label}</span>
      <span className="font-mono text-gray-900 text-right break-all">{value}</span>
    </div>
  );
}

function fmt(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

export function AttendanceDiagnosticsPanel({
  enabled,
  options,
}: {
  enabled: boolean;
  options?: CollectDiagnosticsOptions;
}) {
  const [diagnostics, setDiagnostics] = useState<AttendanceDiagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!enabled) return null;

  const run = async () => {
    setLoading(true);
    setError("");
    try {
      setDiagnostics(await collectAttendanceDiagnostics(options));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to collect diagnostics");
    } finally {
      setLoading(false);
    }
  };

  const d = diagnostics;

  return (
    <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-amber-900">Attendance diagnostics (internal)</h3>
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
        >
          {loading ? "Collecting…" : d ? "Refresh" : "Run diagnostics"}
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {d && (
        <div className="mt-3 space-y-3">
          <div
            className={`rounded-lg px-3 py-2 text-xs font-medium ${
              d.automaticAttendanceActive ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
            }`}
          >
            {d.automaticAttendanceActive
              ? "Automatic attendance is ACTIVE for this employee."
              : `Inactive: ${d.inactiveReason} — ${
                  d.inactiveReason ? AUTO_ATTENDANCE_INACTIVE_REASON_LABEL[d.inactiveReason] : ""
                }`}
          </div>

          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-800">Assignment</p>
            <Row label="Employee ID" value={fmt(d.employeeId)} />
            <Row label="Assigned job" value={d.assignedJob ? `${d.assignedJob.name} (${d.assignedJob.jobId})` : "—"} />
            <Row label="Job coordinates" value={d.assignedJob ? `${fmt(d.assignedJob.lat)}, ${fmt(d.assignedJob.lng)}` : "—"} />
            <Row label="Address verified" value={fmt(d.assignedJob?.addressVerified)} />
            <Row label="Usable coordinates" value={fmt(d.hasUsableCoordinates)} />
          </div>

          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-800">Geofence &amp; schedule</p>
            <Row label="Arrival radius (ft)" value={fmt(d.geofenceRadiusFeet)} />
            <Row label="Arrival radius (m)" value={d.geofenceRadiusMeters !== null ? d.geofenceRadiusMeters.toFixed(0) : "—"} />
            <Row label="Wake radius (m)" value={fmt(d.wakeRadiusMeters)} />
            <Row label="Monitoring lead (min)" value={fmt(d.monitoringLeadMinutes)} />
            <Row label="Scheduled start" value={fmt(d.schedule?.startAt)} />
            <Row label="Scheduled end" value={fmt(d.schedule?.endAt)} />
            <Row label="Monitoring window active" value={fmt(d.monitoringWindow.active)} />
          </div>

          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-800">Permissions</p>
            <Row label="Foreground" value={fmt(d.permissions.foreground)} />
            <Row label="Background" value={fmt(d.permissions.background)} />
            <Row label="Precise location" value={fmt(d.permissions.preciseLocation)} />
            <Row label="Location services" value={fmt(d.permissions.locationServicesEnabled)} />
          </div>

          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-800">Location &amp; distance</p>
            <Row label="Current location" value={d.location ? `${fmt(d.location.lat)}, ${fmt(d.location.lng)}` : "—"} />
            <Row label="Accuracy (m)" value={fmt(d.location?.accuracyMeters)} />
            <Row label="Captured at" value={fmt(d.location?.capturedAt)} />
            <Row label="Location usable" value={`${fmt(d.locationUsable)} (${d.locationRejectedReason})`} />
            <Row label="Distance to jobsite (m)" value={d.distanceMeters !== null ? d.distanceMeters.toFixed(0) : "—"} />
            <Row label="Within geofence" value={fmt(d.isWithinGeofence)} />
          </div>

          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-800">Native geofencing</p>
            <Row label="Native supported" value={fmt(d.nativeGeofenceSupported)} />
            <Row label="Registered geofences" value={fmt(d.registeredGeofences.length)} />
            <Row label="Assigned job registered" value={fmt(d.assignedJobGeofenceRegistered)} />
            <Row label="Last geofence entry" value={fmt(d.lastGeofenceEntryAt)} />
            <Row label="Last geofence exit" value={fmt(d.lastGeofenceExitAt)} />
            <Row label="Last successful sync" value={fmt(d.lastSuccessfulSyncAt)} />
          </div>

          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-800">Offline queue</p>
            <Row label="Pending events" value={fmt(d.queue?.pendingCount)} />
            <Row label="Quarantined events" value={fmt(d.queue?.quarantinedCount)} />
            <Row label="Oldest queued event" value={fmt(d.queue?.oldestOccurredAt)} />
            <Row label="Next retry at" value={fmt(d.queue?.nextAttemptAt)} />
            <Row label="Last sync failure" value={fmt(d.queue?.lastFailureAt)} />
            <Row label="Last failure reason" value={fmt(d.queue?.lastFailureReason)} />
            <Row label="Durable native store" value={fmt(d.queue?.durableStore)} />
          </div>

          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-800">State</p>
            <Row label="Attendance status" value={fmt(d.attendanceStatus)} />
            <Row label="Snapshot captured at" value={fmt(d.capturedAt)} />
          </div>

          <p className="text-[11px] text-amber-700">
            Internal diagnostics — contains a single current location fix and no credentials. Do not share
            outside the company&apos;s administrators.
          </p>
        </div>
      )}
    </div>
  );
}
