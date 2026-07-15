/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { JOBSITE_TIME_PRIVACY_COPY } from '@/lib/jobsite-time/domain';
import { requestJobsiteLocationPermission } from '@/lib/jobsite-time/geofence-client';

// Employee-facing summary of Automatic Jobsite Time. Shows today's status, the
// privacy explanation, and keeps a manual clock-in/out fallback. It is
// intentionally non-invasive: no map, no live location.
export function JobsiteTimeEmployeeCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [manualFallback, setManualFallback] = useState(true);
  const [today, setToday] = useState<any | null>(null);
  const [permission, setPermission] = useState<string>('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsRes, cardsRes] = await Promise.all([
        fetch('/api/jobsite-time/settings', { cache: 'no-store' }).catch(() => null),
        fetch('/api/jobsite-time/timecards', { cache: 'no-store' }).catch(() => null),
      ]);
      if (settingsRes?.ok) {
        const s = (await settingsRes.json())?.item;
        setEnabled(Boolean(s?.enabled));
        setManualFallback(s?.manualFallbackEnabled ?? true);
      } else {
        setEnabled(false);
      }
      if (cardsRes?.ok) {
        const items = (await cardsRes.json())?.items || [];
        const t = new Date().toISOString().slice(0, 10);
        setToday(items.find((i: any) => i.workDate === t) || null);
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

  if (loading || enabled === null) return null;

  const status = !enabled
    ? 'Not tracking'
    : !today
      ? 'Waiting for arrival'
      : today.clockOutAt
        ? 'Left'
        : today.status === 'needs_review'
          ? 'Needs review'
          : today.clockInAt
            ? 'Checked In'
            : 'Waiting for arrival';

  const statusStyle: Record<string, string> = {
    'Not tracking': 'bg-gray-100 text-gray-700',
    'Waiting for arrival': 'bg-blue-100 text-blue-700',
    'Checked In': 'bg-green-100 text-green-700',
    'Left': 'bg-amber-100 text-amber-700',
    'Needs review': 'bg-orange-100 text-orange-700',
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-zinc-800 dark:bg-[#090909]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Attendance</p>
          <p className="text-xs text-gray-500 dark:text-zinc-400">Assigned job · Arrived &amp; Left</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusStyle[status] || 'bg-gray-100 text-gray-700'}`}>{status}</span>
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
            onClick={async () => setPermission(await requestJobsiteLocationPermission())}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-[#111]"
          >
            Allow location
          </button>
          {permission && <span className="text-xs text-gray-500">Permission: {permission}</span>}
        </div>
      )}

      {manualFallback && (
        <p className="mt-2 text-xs text-gray-500 dark:text-zinc-500">
          Manual clock-in/out remains available if automatic tracking isn&apos;t working.
        </p>
      )}
    </div>
  );
}
