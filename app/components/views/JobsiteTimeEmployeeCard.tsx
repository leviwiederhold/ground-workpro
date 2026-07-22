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
  isNativeGeofenceAvailable,
  onGeofenceTransition,
  registerGeofences,
} from '@/lib/attendance/nativeGeofence';
import {
  enqueueAttendanceEvent,
  flushAttendanceQueue,
  startAttendanceQueueAutoFlush,
} from '@/lib/attendance/offlineQueueClient';
import { enrollDeviceCredential } from '@/lib/attendance/deviceCredentialClient';

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

// Headless Attendance runner. Renders NOTHING.
//
// The "Allow location" ribbon that lived here is gone. Location is now a
// prerequisite for entering the app at all (LocationRequiredGate), so by the
// time this mounts permission has already been granted and there is nothing to
// ask for — one permission experience, not one per feature.
//
// What remains is the part that must keep working: the foreground geofence
// watcher, so arrivals/departures at an assigned job are still detected
// automatically. The permission read here is checkLocationPermission(), which is
// deliberately NON-prompting.
export function JobsiteTimeEmployeeCard() {
  const [settings, setSettings] = useState<any>(null);
  const [assignedJobs, setAssignedJobs] = useState<Array<{ jobId: string; lat: number | null; lng: number | null; addressVerified: boolean; name?: string }>>([]);
  const [permission, setPermission] = useState<string>('');
  const watchRef = useRef<{ stop: () => void } | null>(null);

  const load = useCallback(async () => {
    const [settingsRes, jobsRes] = await Promise.all([
      fetch('/api/jobsite-time/settings', { cache: 'no-store' }).catch(() => null),
      fetchAssignedJobs(),
    ]);
    setAssignedJobs(jobsRes);
    setSettings(settingsRes?.ok ? ((await settingsRes.json())?.item ?? null) : null);
  }, []);

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
      await enrollDeviceCredential();

      const regions = verifiedJobs.flatMap((j) =>
        buildJobsiteRegions(j, arrivalRadiusMeters, wakeRadiusMeters)
      );
      await registerGeofences(regions);

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

  // Headless: the geofence watcher above is this component's entire purpose.
  return null;
}
