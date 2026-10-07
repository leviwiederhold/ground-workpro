/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAssignedJobs, startForegroundGeofenceWatch } from '@/lib/jobsite-time/geofence-client';
import { checkLocationPermission } from '@/lib/jobsite-time/locationPermission';
import { pickNearestAssignedJob } from '@/lib/jobsite-time/domain';
import { reconcileAttendanceState } from '@/lib/jobsite-time/reconcileAttendance';
import type { DiagnosticsLocationFix } from '@/lib/jobsite-time/attendanceDiagnostics';
import {
  isNativeGeofenceAvailable,
  onGeofenceTransition,
  registerGeofences,
} from '@/lib/attendance/nativeGeofence';
import {
  enqueueAttendanceEvent,
  flushAttendanceQueue,
  startAttendanceQueueAutoFlush,
} from '@/lib/attendance/offlineQueueClient';
import { ensureDeviceCredential } from '@/lib/attendance/deviceCredentialClient';
import { loadAssignedAttendanceRegions } from '@/lib/attendance/assignedRegionsClient';
import { getCapacitorNativePlatform } from '@/lib/runtime/isNativePlatform';

const MAX_NATIVE_GEOFENCE_JOBS = 10;

function getFreshLocationFix(): Promise<DiagnosticsLocationFix | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation?.getCurrentPosition) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let settled = false;
    const done = (value: DiagnosticsLocationFix | null) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    navigator.geolocation.getCurrentPosition(
      (position) =>
        done({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracyMeters: position.coords.accuracy ?? null,
          capturedAt: new Date().toISOString(),
        }),
      () => done(null),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
    setTimeout(() => done(null), 12_000);
  });
}

const todayKey = () => new Date().toISOString().slice(0, 10);

/**
 * Headless runtime for the already-configured location pipeline.
 *
 * It deliberately renders nothing. Employee-facing status, failure wording,
 * timelines, and manual actions do not belong in the application UI; managers
 * use the separately role-protected management view.
 */
export function LocationBackgroundRuntime() {
  const [settings, setSettings] = useState<any>(null);
  const [assignedJobs, setAssignedJobs] = useState<
    Array<{
      jobId: string;
      lat: number | null;
      lng: number | null;
      addressVerified: boolean;
      name?: string;
    }>
  >([]);
  const [permission, setPermission] = useState<string>('');
  const watchRef = useRef<{ stop: () => void } | null>(null);

  const load = useCallback(async () => {
    const [settingsRes, jobs] = await Promise.all([
      fetch('/api/jobsite-time/settings', { cache: 'no-store' }).catch(() => null),
      fetchAssignedJobs(),
    ]);
    setAssignedJobs(jobs);
    setSettings(settingsRes?.ok ? ((await settingsRes.json())?.item ?? null) : null);
  }, []);

  const syncPermission = useCallback(async () => {
    setPermission(await checkLocationPermission());
  }, []);

  useEffect(() => startAttendanceQueueAutoFlush(), []);

  const reconcileForeground = useCallback(async () => {
    const currentPermission = await checkLocationPermission();
    if (currentPermission !== 'granted') return;

    const jobs = await fetchAssignedJobs();
    const verified = jobs.filter(
      (job) => job.addressVerified && job.lat !== null && job.lng !== null,
    );
    if (verified.length === 0) return;

    const [settingsRes, cardsRes, fix] = await Promise.all([
      fetch('/api/attendance/settings', { cache: 'no-store' }).catch(() => null),
      fetch('/api/jobsite-time/timecards', { cache: 'no-store' }).catch(() => null),
      getFreshLocationFix(),
    ]);
    if (!fix) return;

    const settingsPayload =
      settingsRes && settingsRes.ok
        ? await settingsRes.json().catch(() => null)
        : null;
    const settingsItem = settingsPayload?.item ?? null;
    if (settingsItem?.automaticAttendanceEnabled === false) return;

    const arrivalRadiusFeet =
      typeof settingsItem?.geofenceRadiusMeters === 'number'
        ? settingsItem.geofenceRadiusMeters / 0.3048
        : null;
    const monitoringLeadMinutes =
      typeof settingsItem?.monitoringLeadMinutes === 'number'
        ? settingsItem.monitoringLeadMinutes
        : null;
    const earlyArrivalMode =
      settingsItem?.earlyArrivalMode === 'clock_in_on_arrival'
        ? 'clock_in_on_arrival'
        : 'scheduled_start';
    const schedule =
      settingsPayload?.schedule &&
      (settingsPayload.schedule.startAt || settingsPayload.schedule.endAt)
        ? {
            startAt: settingsPayload.schedule.startAt ?? null,
            endAt: settingsPayload.schedule.endAt ?? null,
          }
        : null;

    const nearest = pickNearestAssignedJob(
      verified.map((job) => ({
        jobId: job.jobId,
        lat: job.lat,
        lng: job.lng,
        addressVerified: job.addressVerified,
      })),
      { lat: fix.lat as number, lng: fix.lng as number },
    );
    if (!nearest) return;

    let todayCard: {
      clockInAt: string | null;
      clockOutAt: string | null;
      status: string;
    } | null = null;
    if (cardsRes?.ok) {
      const items: any[] = (await cardsRes.json())?.items ?? [];
      const item = items.find(
        (card) => String(card.workDate ?? '').slice(0, 10) === todayKey(),
      );
      if (item) {
        todayCard = {
          clockInAt: item.clockInAt ?? null,
          clockOutAt: item.clockOutAt ?? null,
          status: String(item.status ?? ''),
        };
      }
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
      schedule,
      monitoringLeadMinutes,
      earlyArrivalMode,
      todayCard,
    });

    if (!result.shouldCreateClockIn) return;
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
  }, [load]);

  useEffect(() => {
    void load();
    void syncPermission();
    void reconcileForeground();
    const onFocus = () => {
      void load();
      void syncPermission();
      if (document.visibilityState !== 'hidden') void reconcileForeground();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [load, syncPermission, reconcileForeground]);

  useEffect(() => {
    watchRef.current?.stop();
    watchRef.current = null;
    if (permission !== 'granted' || isNativeGeofenceAvailable()) return;
    const verifiedJobs = assignedJobs.filter((job) => job.addressVerified);
    if (verifiedJobs.length === 0) return;
    watchRef.current = startForegroundGeofenceWatch({
      jobs: verifiedJobs,
      wakeRadiusMeters: settings?.wakeRadiusMeters,
      arrivalRadiusFeet: settings?.arrivalRadiusFeet,
      onEvent: () => void load(),
    });
    return () => watchRef.current?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings?.wakeRadiusMeters,
    settings?.arrivalRadiusFeet,
    permission,
    assignedJobs.length,
  ]);

  useEffect(() => {
    if (permission !== 'granted' || !isNativeGeofenceAvailable()) return;
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;

    void (async () => {
      const verifiedJobs = assignedJobs
        .filter(
          (job) => job.addressVerified && job.lat !== null && job.lng !== null,
        )
        .slice(0, MAX_NATIVE_GEOFENCE_JOBS);

      // The gate already enrolled a credential. This verifies the Keychain
      // state and rotates only near expiry; it must not mint on every focus or
      // render.
      await ensureDeviceCredential(getCapacitorNativePlatform() ?? 'ios');
      const regions = await loadAssignedAttendanceRegions(verifiedJobs);
      await registerGeofences(regions);

      unsubscribe = await onGeofenceTransition(async (event) => {
        if (cancelled || event.zone !== 'arrival') return;
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
  }, [
    settings?.wakeRadiusMeters,
    settings?.arrivalRadiusFeet,
    permission,
    assignedJobs.length,
  ]);

  return null;
}
