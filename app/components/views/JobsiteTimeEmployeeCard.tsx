/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAssignedJobs, startForegroundGeofenceWatch } from '@/lib/jobsite-time/geofence-client';
import { checkLocationPermission } from '@/lib/jobsite-time/locationPermission';

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

  useEffect(() => {
    load();
    syncPermission();
    // Re-read company work hours / attendance state when the tab regains focus,
    // so changes saved in Settings show up here without a full page reload.
    const onFocus = () => { load(); syncPermission(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [load, syncPermission]);

  // Run the foreground geofence watcher whenever we have at least one verified
  // assigned job and location permission is granted. Attendance is permanent —
  // it is never gated on an enable/disable flag.
  useEffect(() => {
    watchRef.current?.stop();
    watchRef.current = null;
    if (permission !== 'granted') return;
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

  // Headless: the geofence watcher above is this component's entire purpose.
  return null;
}
