/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ATTENDANCE_STATUS_LABEL, JOBSITE_TIME_PRIVACY_COPY, deriveAttendanceStatus } from '@/lib/jobsite-time/domain';
import { fetchAssignedJobs, startForegroundGeofenceWatch } from '@/lib/jobsite-time/geofence-client';
import { requestLocationPermissionInteractive } from '@/lib/jobsite-time/locationPermission';

// Employee-facing summary of Attendance. Shows today's status in plain
// language, keeps a manual clock-in/out fallback, and (when location is
// granted) runs the foreground geofence watcher so arrivals/departures at an
// assigned job are detected automatically. No map, no live location, no
// technical terms (confidence/source/geofence/event ingestion).
export function JobsiteTimeEmployeeCard() {
  const [settings, setSettings] = useState<any>(null);
  const [today, setToday] = useState<any | null>(null);
  const [hasStaleOpenCard, setHasStaleOpenCard] = useState(false);
  const [assignedJobs, setAssignedJobs] = useState<Array<{ jobId: string; lat: number | null; lng: number | null; addressVerified: boolean; name?: string }>>([]);
  const [permission, setPermission] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const watchRef = useRef<{ stop: () => void } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsRes, cardsRes, jobsRes] = await Promise.all([
        fetch('/api/jobsite-time/settings', { cache: 'no-store' }).catch(() => null),
        fetch('/api/jobsite-time/timecards', { cache: 'no-store' }).catch(() => null),
        fetchAssignedJobs(),
      ]);
      setAssignedJobs(jobsRes);
      if (settingsRes?.ok) {
        setSettings((await settingsRes.json())?.item ?? null);
      } else {
        setSettings(null);
      }
      if (cardsRes?.ok) {
        const items = (await cardsRes.json())?.items || [];
        const t = new Date().toISOString().slice(0, 10);
        setToday(items.find((i: any) => i.workDate === t) || null);
        setHasStaleOpenCard(items.some((i: any) => i.clockInAt && !i.clockOutAt && i.workDate && i.workDate < t));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
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

  if (loading || !settings) return null;

  const enabled = Boolean(settings.enabled);
  const hasAssignedJob = assignedJobs.length > 0;
  const assignedJobAddressVerified = assignedJobs.some((j) => j.addressVerified);

  const status = !enabled
    ? null
    : deriveAttendanceStatus({
        hasAssignedJob,
        assignedJobAddressVerified,
        todayCard: today ? { clockInAt: today.clockInAt, clockOutAt: today.clockOutAt, status: today.status } : null,
        hasStaleOpenCard,
      });

  const statusText = status ? ATTENDANCE_STATUS_LABEL[status] : 'Not tracking';

  const statusStyle: Record<string, string> = {
    'Not tracking': 'bg-gray-100 text-gray-700',
    'No assigned job': 'bg-gray-100 text-gray-700',
    'Address needs verification': 'bg-red-100 text-red-700',
    'Waiting for arrival': 'bg-blue-100 text-blue-700',
    'Checked in': 'bg-green-100 text-green-700',
    'Checked out': 'bg-amber-100 text-amber-700',
    'Needs review': 'bg-orange-100 text-orange-700',
    'Missing clock-out': 'bg-red-100 text-red-700',
  };

  const jobName = today ? assignedJobs.find((j) => j.jobId === String(today.jobId))?.name : undefined;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-zinc-800 dark:bg-[#090909]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Attendance</p>
          <p className="text-xs text-gray-500 dark:text-zinc-400">{jobName ? `Checked in at ${jobName}` : 'Assigned job · Arrived & Left'}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusStyle[statusText] || 'bg-gray-100 text-gray-700'}`}>{statusText}</span>
      </div>

      {enabled && today && (
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div><p className="text-xs text-gray-500">Arrived</p><p className="font-medium tabular-nums text-gray-900 dark:text-zinc-100">{today.clockInAt ? new Date(today.clockInAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'}</p></div>
          <div><p className="text-xs text-gray-500">Left</p><p className="font-medium tabular-nums text-gray-900 dark:text-zinc-100">{today.clockOutAt ? new Date(today.clockOutAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'}</p></div>
        </div>
      )}

      <p className="mt-3 rounded-lg bg-gray-50 p-2.5 text-xs leading-relaxed text-gray-600 dark:bg-[#050505] dark:text-zinc-400">
        {JOBSITE_TIME_PRIVACY_COPY}
      </p>

      {enabled && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
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
      )}

      {settings.manualFallbackEnabled && (
        <p className="mt-2 text-xs text-gray-500 dark:text-zinc-500">
          Manual clock-in/out remains available if automatic tracking isn&apos;t working.
        </p>
      )}
    </div>
  );
}
