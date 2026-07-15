/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAssignedJobs, startForegroundGeofenceWatch } from '@/lib/jobsite-time/geofence-client';
import { requestLocationPermissionInteractive } from '@/lib/jobsite-time/locationPermission';

// Employee-facing Attendance entry point. It intentionally shows NO tracking
// status, arrival/departure times, geofence state, or fallback copy to
// employees — only the location-permission control (from PR #51). When
// location is granted it runs the foreground geofence watcher in the
// background so arrivals/departures at an assigned job are detected
// automatically. No map, no live location, no employee-facing implementation
// detail. Any diagnostics stay in console/dev tooling.
export function JobsiteTimeEmployeeCard() {
  const [settings, setSettings] = useState<any>(null);
  const [assignedJobs, setAssignedJobs] = useState<Array<{ jobId: string; lat: number | null; lng: number | null; addressVerified: boolean; name?: string }>>([]);
  const [permission, setPermission] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const watchRef = useRef<{ stop: () => void } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsRes, jobsRes] = await Promise.all([
        fetch('/api/jobsite-time/settings', { cache: 'no-store' }).catch(() => null),
        fetchAssignedJobs(),
      ]);
      setAssignedJobs(jobsRes);
      if (settingsRes?.ok) {
        setSettings((await settingsRes.json())?.item ?? null);
      } else {
        setSettings(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Re-read company work hours / attendance state when the tab regains focus,
    // so changes saved in Settings show up here without a full page reload.
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [load]);

  // Run the foreground geofence watcher whenever Attendance is on, we have at
  // least one verified assigned job, and location permission is granted.
  useEffect(() => {
    watchRef.current?.stop();
    watchRef.current = null;
    if (!settings?.enabled || permission !== 'granted') return;
    const verifiedJobs = assignedJobs.filter((j) => j.addressVerified);
    if (verifiedJobs.length === 0) return;
    watchRef.current = startForegroundGeofenceWatch({
      jobs: verifiedJobs,
      wakeRadiusMeters: settings.wakeRadiusMeters,
      arrivalRadiusFeet: settings.arrivalRadiusFeet,
      onEvent: () => load(),
    });
    return () => watchRef.current?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.enabled, settings?.wakeRadiusMeters, settings?.arrivalRadiusFeet, permission, assignedJobs.length]);

  if (loading || !settings || !settings.enabled) return null;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-zinc-800 dark:bg-[#090909]">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={async () => setPermission(await requestLocationPermissionInteractive())}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-[#111]"
        >
          Allow location
        </button>
        {permission === 'granted' && <span className="text-xs text-green-600 dark:text-green-400">Location on</span>}
        {permission === 'denied' && <span className="text-xs text-red-600 dark:text-red-400">Location off — enable it in Settings</span>}
        {permission === 'unavailable' && <span className="text-xs text-amber-600 dark:text-amber-400">Location unavailable on this device</span>}
      </div>
    </div>
  );
}
