/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAssignedJobs, startForegroundGeofenceWatch } from '@/lib/jobsite-time/geofence-client';
import { checkLocationPermission } from '@/lib/jobsite-time/locationPermission';
import { feetToMeters, pickNearestAssignedJob } from '@/lib/jobsite-time/domain';
import { reconcileAttendanceState } from '@/lib/jobsite-time/reconcileAttendance';
import type { DiagnosticsLocationFix } from '@/lib/jobsite-time/attendanceDiagnostics';
import {
  buildJobsiteRegions,
  getNativeGeofenceHealth,
  getRegisteredGeofences,
  isNativeGeofenceAvailable,
  onGeofenceTransition,
  registerGeofences,
} from '@/lib/attendance/nativeGeofence';
import {
  enqueueAttendanceEvent,
  flushAttendanceQueue,
  getAttendanceQueueDiagnostics,
  startAttendanceQueueAutoFlush,
} from '@/lib/attendance/offlineQueueClient';
import { enrollDeviceCredential } from '@/lib/attendance/deviceCredentialClient';
import {
  deriveAttendanceLifecycle,
  isBlockingIssue,
  LIFECYCLE_DESCRIPTION,
  LIFECYCLE_LABEL,
  type AttendanceLifecycleState,
  type LifecycleInput,
} from '@/lib/attendance/lifecycleState';

// iOS monitors at most 20 regions; each job uses 2 (arrival + wake).
const MAX_NATIVE_GEOFENCE_JOBS = 10;

// One fresh, high-accuracy fix (never a cached/continuous stream). Resolves null
// on any failure so reconciliation degrades gracefully rather than throwing.
function getFreshLocationFix(): Promise<DiagnosticsLocationFix | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation?.getCurrentPosition) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: DiagnosticsLocationFix | null) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
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
    setTimeout(() => done(null), 12000);
  });
}

const todayKey = () => new Date().toISOString().slice(0, 10);

// Tone per lifecycle state. "Working" states are green/blue; anything the
// employee or their manager has to act on is amber/red. Nothing that is broken
// is ever styled as though it were fine.
const STATE_TONE: Record<AttendanceLifecycleState, string> = {
  automatic_attendance_disabled: 'bg-gray-100 text-gray-700 border-gray-200',
  permission_setup_required: 'bg-red-50 text-red-800 border-red-200',
  background_permission_missing: 'bg-red-50 text-red-800 border-red-200',
  precise_location_unavailable: 'bg-red-50 text-red-800 border-red-200',
  monitoring_starts_at: 'bg-gray-100 text-gray-700 border-gray-200',
  monitoring_active: 'bg-blue-50 text-blue-800 border-blue-200',
  waiting_for_arrival: 'bg-blue-50 text-blue-800 border-blue-200',
  onsite_before_shift: 'bg-blue-50 text-blue-800 border-blue-200',
  clocked_in_automatically: 'bg-green-50 text-green-800 border-green-200',
  departure_pending: 'bg-amber-50 text-amber-900 border-amber-200',
  clocked_out_automatically: 'bg-green-50 text-green-800 border-green-200',
  no_assignment_today: 'bg-gray-100 text-gray-700 border-gray-200',
  jobsite_missing_coordinates: 'bg-red-50 text-red-800 border-red-200',
  native_geofence_unavailable: 'bg-amber-50 text-amber-900 border-amber-200',
  offline_events_pending: 'bg-amber-50 text-amber-900 border-amber-200',
  automatic_attendance_degraded: 'bg-red-50 text-red-800 border-red-200',
  last_sync_failed: 'bg-amber-50 text-amber-900 border-amber-200',
};

const STATE_ICON: Record<AttendanceLifecycleState, string> = {
  automatic_attendance_disabled: 'fa-circle-minus',
  permission_setup_required: 'fa-location-crosshairs',
  background_permission_missing: 'fa-location-crosshairs',
  precise_location_unavailable: 'fa-location-crosshairs',
  monitoring_starts_at: 'fa-clock',
  monitoring_active: 'fa-satellite-dish',
  waiting_for_arrival: 'fa-satellite-dish',
  onsite_before_shift: 'fa-hourglass-half',
  clocked_in_automatically: 'fa-circle-check',
  departure_pending: 'fa-arrow-right-from-bracket',
  clocked_out_automatically: 'fa-circle-check',
  no_assignment_today: 'fa-calendar-xmark',
  jobsite_missing_coordinates: 'fa-map-location-dot',
  native_geofence_unavailable: 'fa-mobile-screen',
  offline_events_pending: 'fa-cloud-arrow-up',
  automatic_attendance_degraded: 'fa-triangle-exclamation',
  last_sync_failed: 'fa-cloud-arrow-up',
};

const fmtClock = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';

// Everything the lifecycle derivation needs, gathered from the signals this
// component already collects. Defaults are deliberately PESSIMISTIC: before the
// first refresh completes the card must not claim monitoring is active.
const INITIAL_SIGNALS: LifecycleInput = {
  automaticAttendanceEnabled: true,
  hasAssignmentToday: false,
  jobsiteHasVerifiedCoordinates: false,
  foregroundPermission: 'unknown',
  backgroundPermission: 'unknown',
  preciseLocation: null,
  nativeGeofenceSupported: false,
  assignedJobGeofenceRegistered: null,
  deviceCredentialActive: null,
  monitoringWindowActive: null,
  monitoringStartsAt: null,
  onsite: null,
  todayCard: null,
  pendingQueueCount: 0,
  lastSyncFailed: false,
  manualFallbackEnabled: true,
};

// Attendance runner + the employee's status card.
//
// This used to render nothing, which meant the only way to know whether
// automatic attendance was working was to open a debug panel. It now shows the
// derived lifecycle state — and the derivation refuses to claim monitoring is
// active unless every prerequisite is genuinely satisfied.
//
// The "Allow location" ribbon that lived here is gone. Location is a
// prerequisite for entering the app at all (LocationRequiredGate), so by the
// time this mounts permission has already been granted — one permission
// experience, not one per feature. The permission read here is
// checkLocationPermission(), which is deliberately NON-prompting.
export function JobsiteTimeEmployeeCard() {
  const [settings, setSettings] = useState<any>(null);
  const [assignedJobs, setAssignedJobs] = useState<Array<{ jobId: string; lat: number | null; lng: number | null; addressVerified: boolean; name?: string }>>([]);
  const [permission, setPermission] = useState<string>('');
  const [signals, setSignals] = useState<LifecycleInput>(INITIAL_SIGNALS);
  const [assignedJobName, setAssignedJobName] = useState<string>('');
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState('');
  const watchRef = useRef<{ stop: () => void } | null>(null);

  // Gather every signal the lifecycle derivation needs. Each source is guarded:
  // a source that cannot answer contributes null/unknown, which the derivation
  // treats as "cannot confirm" rather than "fine".
  const refreshSignals = useCallback(async () => {
    const [attendanceRes, planRes, cardsRes, perm, health, registered] = await Promise.all([
      fetch('/api/attendance/settings', { cache: 'no-store' }).catch(() => null),
      fetch('/api/attendance/monitoring-plan', { cache: 'no-store' }).catch(() => null),
      fetch('/api/jobsite-time/timecards', { cache: 'no-store' }).catch(() => null),
      checkLocationPermission().catch(() => 'unknown'),
      getNativeGeofenceHealth().catch(() => null),
      getRegisteredGeofences().catch(() => []),
    ]);

    const attendance = attendanceRes?.ok ? (await attendanceRes.json().catch(() => null))?.item ?? null : null;
    const plan = planRes?.ok ? await planRes.json().catch(() => null) : null;

    let todayCard: LifecycleInput['todayCard'] = null;
    if (cardsRes?.ok) {
      const items: any[] = (await cardsRes.json().catch(() => null))?.items ?? [];
      const t = items.find((c) => String(c.workDate ?? '').slice(0, 10) === todayKey());
      if (t) {
        todayCard = {
          clockInAt: t.clockInAt ?? null,
          clockOutAt: t.clockOutAt ?? null,
          pendingDepartureAt: t.pendingDepartureAt ?? null,
          onsiteBeforeShiftAt: t.onsiteBeforeShiftAt ?? null,
        };
      }
    }

    const queue = getAttendanceQueueDiagnostics();
    const monitoredJobId = plan?.regions?.[0]?.jobId ?? null;
    const nativeSupported = Boolean(health?.supported);

    setSignals((prev) => ({
      ...prev,
      automaticAttendanceEnabled: attendance?.automaticAttendanceEnabled !== false,
      manualFallbackEnabled: attendance?.manualFallbackEnabled !== false,
      hasAssignmentToday: plan ? Boolean(plan.hasAssignment) : prev.hasAssignmentToday,
      jobsiteHasVerifiedCoordinates: plan
        ? Boolean(plan.hasVerifiedCoordinates)
        : prev.jobsiteHasVerifiedCoordinates,
      foregroundPermission: perm as LifecycleInput['foregroundPermission'],
      // The OS background-authorization answer, only where it means anything.
      backgroundPermission: nativeSupported ? (health?.authorized ? 'granted' : 'denied') : 'unavailable',
      nativeGeofenceSupported: nativeSupported,
      assignedJobGeofenceRegistered: nativeSupported
        ? monitoredJobId
          ? registered.some((r) => String(r.jobId) === String(monitoredJobId))
          : registered.length > 0
        : null,
      monitoringWindowActive: plan?.plan ? Boolean(plan.plan.active) : null,
      monitoringStartsAt: plan?.plan?.nextWindowStartsAt ?? null,
      todayCard,
      pendingQueueCount: queue.pendingCount,
      lastSyncFailed: Boolean(
        queue.lastFailureAt &&
          (!queue.lastSuccessfulSyncAt ||
            Date.parse(queue.lastFailureAt) > Date.parse(queue.lastSuccessfulSyncAt))
      ),
    }));
  }, []);

  const load = useCallback(async () => {
    const [settingsRes, jobsRes] = await Promise.all([
      fetch('/api/jobsite-time/settings', { cache: 'no-store' }).catch(() => null),
      fetchAssignedJobs(),
    ]);
    setAssignedJobs(jobsRes);
    setAssignedJobName(jobsRes.find((j) => j.addressVerified)?.name ?? jobsRes[0]?.name ?? '');
    setSettings(settingsRes?.ok ? ((await settingsRes.json())?.item ?? null) : null);
    await refreshSignals();
  }, [refreshSignals]);

  // Non-prompting: never surfaces a dialog.
  const syncPermission = useCallback(async () => {
    setPermission(await checkLocationPermission());
  }, []);

  // Durable offline queue: flush on mount, on network recovery, and periodically
  // so attendance events generated offline are eventually submitted exactly once.
  useEffect(() => startAttendanceQueueAutoFlush(), []);

  // Foreground reconciliation (PR: basic correctness layer). On launch/resume,
  // take ONE fresh fix and reconcile the attendance state so opening the app
  // while already onsite repairs the clock-in instead of sitting on "Waiting for
  // arrival". The server (jobsite-time/events) stays authoritative: it
  // re-validates distance + schedule, so we only ask it to record an arrival.
  const reconcileForeground = useCallback(async () => {
    const perm = await checkLocationPermission();
    if (perm !== 'granted') return;

    const jobs = await fetchAssignedJobs();
    const verified = jobs.filter((j) => j.addressVerified && j.lat !== null && j.lng !== null);
    if (verified.length === 0) return; // missing coords → surfaced by status derivation, not here

    const [settingsRes, cardsRes, fix] = await Promise.all([
      // Company automatic-attendance settings: radius, monitoring lead time,
      // early-arrival behavior, and TODAY's schedule (already computed in the
      // company timezone by the server).
      fetch('/api/attendance/settings', { cache: 'no-store' }).catch(() => null),
      fetch('/api/jobsite-time/timecards', { cache: 'no-store' }).catch(() => null),
      getFreshLocationFix(),
    ]);
    if (!fix) return; // no usable fix → cannot prove onsite; leave state as-is

    const settingsPayload = settingsRes && settingsRes.ok ? await settingsRes.json().catch(() => null) : null;
    const settingsItem = settingsPayload?.item ?? null;
    // Arrival radius is stored in meters; reconcile works in feet.
    const arrivalRadiusFeet =
      settingsItem && typeof settingsItem.geofenceRadiusMeters === 'number'
        ? settingsItem.geofenceRadiusMeters / 0.3048
        : null;
    const monitoringLeadMinutes =
      settingsItem && typeof settingsItem.monitoringLeadMinutes === 'number' ? settingsItem.monitoringLeadMinutes : null;
    const earlyArrivalMode =
      settingsItem?.earlyArrivalMode === 'clock_in_on_arrival' ? 'clock_in_on_arrival' : 'scheduled_start';
    const schedule =
      settingsPayload?.schedule && (settingsPayload.schedule.startAt || settingsPayload.schedule.endAt)
        ? { startAt: settingsPayload.schedule.startAt ?? null, endAt: settingsPayload.schedule.endAt ?? null }
        : null;

    // Respect the master switch: when automatic attendance is disabled for the
    // company, do not auto-reconcile a clock-in.
    if (settingsItem && settingsItem.automaticAttendanceEnabled === false) return;

    const nearest = pickNearestAssignedJob(
      verified.map((j) => ({ jobId: j.jobId, lat: j.lat, lng: j.lng, addressVerified: j.addressVerified })),
      { lat: fix.lat as number, lng: fix.lng as number }
    );
    if (!nearest) return;

    // Today's own open card, if any (the timecards endpoint is self-scoped).
    let todayCard: { clockInAt: string | null; clockOutAt: string | null; status: string } | null = null;
    if (cardsRes && cardsRes.ok) {
      const items: any[] = (await cardsRes.json())?.items ?? [];
      const t = items.find((c) => String(c.workDate ?? '').slice(0, 10) === todayKey());
      if (t) todayCard = { clockInAt: t.clockInAt ?? null, clockOutAt: t.clockOutAt ?? null, status: String(t.status ?? '') };
    }

    const result = reconcileAttendanceState({
      assignedJob: {
        jobId: nearest.job.jobId,
        lat: nearest.job.lat,
        lng: nearest.job.lng,
        addressVerified: nearest.job.addressVerified,
      },
      arrivalRadiusFeet,
      location: fix,
      // Schedule (company timezone) + monitoring lead + early-arrival mode now
      // come from the company attendance settings; the server still re-validates
      // distance + schedule when the arrival event is ingested.
      schedule,
      monitoringLeadMinutes,
      earlyArrivalMode,
      todayCard,
    });

    // Where the employee actually is, from THIS fix. The lifecycle derivation
    // will only say "waiting for arrival" when this is explicitly false.
    setSignals((prev) => ({ ...prev, onsite: result.onsite }));

    if (result.shouldCreateClockIn) {
      // Queue (durable) then flush, so a reconcile clock-in made while offline
      // is preserved and retried rather than lost.
      await enqueueAttendanceEvent({
        jobId: nearest.job.jobId,
        zone: 'arrival',
        transition: 'enter',
        occurredAt: fix.capturedAt ?? new Date().toISOString(),
        latitude: fix.lat,
        longitude: fix.lng,
        accuracyMeters: fix.accuracyMeters,
      });
      await flushAttendanceQueue();
      await load();
    }
  }, [load]);

  useEffect(() => {
    load();
    syncPermission();
    // Launch: reconcile onsite state from a fresh fix.
    void reconcileForeground();
    // Resume/focus: re-read settings + reconcile again (app launch and resume
    // are the two moments the foreground fallback must correct the state).
    const onFocus = () => {
      load();
      syncPermission();
      if (document.visibilityState !== 'hidden') void reconcileForeground();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [load, syncPermission, reconcileForeground]);

  // Run the foreground geofence watcher whenever we have at least one verified
  // assigned job and location permission is granted. Attendance is permanent —
  // it is never gated on an enable/disable flag.
  //
  // When the NATIVE geofence plugin is present it owns detection (including
  // background), so the foreground watch stands down to avoid duplicate events.
  useEffect(() => {
    watchRef.current?.stop();
    watchRef.current = null;
    if (permission !== 'granted') return;
    if (isNativeGeofenceAvailable()) return;
    const verifiedJobs = assignedJobs.filter((j) => j.addressVerified);
    if (verifiedJobs.length === 0) return;
    watchRef.current = startForegroundGeofenceWatch({
      jobs: verifiedJobs,
      wakeRadiusMeters: settings?.wakeRadiusMeters,
      arrivalRadiusFeet: settings?.arrivalRadiusFeet,
      onEvent: () => load(),
    });
    return () => watchRef.current?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.wakeRadiusMeters, settings?.arrivalRadiusFeet, permission, assignedJobs.length]);

  // Native background geofencing: register the assigned jobs' regions with the
  // OS so arrival/departure are detected while the app is backgrounded or
  // closed. The native layer POSTs background transitions to the events API
  // itself; here we also forward any FOREGROUND transition it emits and refresh.
  // No-op when the native plugin isn't present (web / not-yet-bundled build).
  useEffect(() => {
    if (permission !== 'granted' || !isNativeGeofenceAvailable()) return;
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      const arrivalRadiusMeters = settings?.arrivalRadiusFeet
        ? feetToMeters(settings.arrivalRadiusFeet)
        : 76; // ~250 ft default
      const wakeRadiusMeters = settings?.wakeRadiusMeters ?? 1609;
      const verifiedJobs = assignedJobs
        .filter((j) => j.addressVerified && j.lat !== null && j.lng !== null)
        .slice(0, MAX_NATIVE_GEOFENCE_JOBS);
      // Enroll a device attendance credential so the native layer can submit
      // background events without WebView cookies. Best-effort: a no-op unless a
      // native secure store is present (never mints a token it can't store).
      const enrolled = await enrollDeviceCredential();
      // Without a credential the native layer cannot submit background events,
      // so monitoring is NOT active however healthy everything else looks.
      setSignals((prev) => ({ ...prev, deviceCredentialActive: enrolled }));

      const regions = verifiedJobs.flatMap((j) =>
        buildJobsiteRegions(j, arrivalRadiusMeters, wakeRadiusMeters)
      );
      const registeredOk = await registerGeofences(regions);
      setSignals((prev) => ({
        ...prev,
        assignedJobGeofenceRegistered: regions.length > 0 ? registeredOk : prev.assignedJobGeofenceRegistered,
      }));

      unsubscribe = await onGeofenceTransition(async (event) => {
        if (cancelled) return;
        if (event.zone !== 'arrival') return; // wake only starts monitoring
        // Durable-queue foreground-delivered transitions (dedup + offline-safe).
        await enqueueAttendanceEvent({
          jobId: event.jobId,
          zone: 'arrival',
          transition: event.transition,
          occurredAt: event.occurredAt,
          latitude: event.latitude ?? null,
          longitude: event.longitude ?? null,
          accuracyMeters: event.accuracyMeters ?? null,
        });
        await flushAttendanceQueue();
        await load();
      });
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.wakeRadiusMeters, settings?.arrivalRadiusFeet, permission, assignedJobs.length]);

  // Manual clock in/out — the FALLBACK path. It posts the same event the
  // automatic pipeline does, tagged `manual`, so a manual entry is auditable
  // and deduped by the same server-side guards.
  const submitManual = useCallback(
    async (transition: 'enter' | 'exit') => {
      const job = assignedJobs.find((j) => j.addressVerified) ?? assignedJobs[0];
      if (!job) {
        setManualError('You are not assigned to a job.');
        return;
      }
      setManualBusy(true);
      setManualError('');
      try {
        const res = await fetch('/api/jobsite-time/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobId: job.jobId,
            zone: 'arrival',
            transition,
            occurredAt: new Date().toISOString(),
            source: 'manual',
          }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          setManualError(json?.error || 'Could not record that. Try again.');
          return;
        }
        await load();
      } catch {
        setManualError('Could not record that. Check your connection.');
      } finally {
        setManualBusy(false);
      }
    },
    [assignedJobs, load]
  );

  const lifecycle = deriveAttendanceLifecycle(signals);
  const card = signals.todayCard;
  const isClockedIn = Boolean(card?.clockInAt && !card?.clockOutAt);
  // Secondary issues worth listing under the headline — the headline already
  // names one of them, so it is not repeated.
  const otherIssues = lifecycle.issues.filter((issue) => issue !== lifecycle.state);

  // Times shown are the RECORDED arrival/departure, not a location trail. This
  // card deliberately shows no coordinates, no distance, and no movement
  // history — only the discrete attendance facts.
  const timeline = [
    card?.clockInAt ? `Clocked in ${fmtClock(card.clockInAt)}` : null,
    card?.onsiteBeforeShiftAt && !card?.clockInAt ? `On site since ${fmtClock(card.onsiteBeforeShiftAt)}` : null,
    card?.clockOutAt ? `Clocked out ${fmtClock(card.clockOutAt)}` : null,
  ].filter(Boolean) as string[];

  return (
    <div className={`rounded-xl border p-4 ${STATE_TONE[lifecycle.state]}`}>
      <div className="flex items-start gap-3">
        <i className={`fa-solid ${STATE_ICON[lifecycle.state]} mt-0.5 text-base`} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {LIFECYCLE_LABEL[lifecycle.state]}
            {lifecycle.state === 'monitoring_starts_at' && lifecycle.monitoringStartsAt
              ? ` — ${fmtClock(lifecycle.monitoringStartsAt)}`
              : ''}
          </p>
          <p className="mt-0.5 text-xs opacity-90">{LIFECYCLE_DESCRIPTION[lifecycle.state]}</p>

          {assignedJobName && lifecycle.state !== 'no_assignment_today' && (
            <p className="mt-1 text-xs opacity-75">{assignedJobName}</p>
          )}

          {timeline.length > 0 && (
            <p className="mt-1 text-xs tabular-nums opacity-90">{timeline.join(' · ')}</p>
          )}

          {otherIssues.length > 0 && (
            <ul className="mt-2 space-y-1">
              {otherIssues.map((issue) => (
                <li key={issue} className="flex items-start gap-1.5 text-xs opacity-90">
                  <i
                    className={`fa-solid ${isBlockingIssue(issue) ? 'fa-circle-exclamation' : 'fa-circle-info'} mt-0.5 text-[10px]`}
                    aria-hidden
                  />
                  <span>
                    <span className="font-medium">{LIFECYCLE_LABEL[issue]}</span>
                    {' — '}
                    {LIFECYCLE_DESCRIPTION[issue]}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* Manual clock in/out is SECONDARY and labeled as a fallback: the
              automatic path is the product, and a prominent manual button
              teaches employees to distrust it. It is promoted (not hidden)
              only when the automatic path genuinely cannot record. */}
          {lifecycle.manualFallbackAvailable && (
            <div className="mt-3 border-t border-current/10 pt-2">
              <p className="text-[11px] font-medium uppercase tracking-wide opacity-60">
                Manual fallback
              </p>
              <p className="mt-0.5 text-xs opacity-75">
                {lifecycle.manualFallbackRecommended
                  ? 'Automatic attendance cannot record right now — use this instead.'
                  : 'Only needed if your arrival or departure was not recorded automatically.'}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={manualBusy || isClockedIn}
                  onClick={() => submitManual('enter')}
                  className="rounded-md border border-current/30 px-2.5 py-1 text-xs font-medium disabled:opacity-40"
                >
                  {manualBusy ? 'Working…' : 'Clock in manually'}
                </button>
                <button
                  type="button"
                  disabled={manualBusy || !isClockedIn}
                  onClick={() => submitManual('exit')}
                  className="rounded-md border border-current/30 px-2.5 py-1 text-xs font-medium disabled:opacity-40"
                >
                  {manualBusy ? 'Working…' : 'Clock out manually'}
                </button>
              </div>
              {manualError && <p className="mt-1.5 text-xs font-medium">{manualError}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
