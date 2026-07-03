/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { ALLOWED_GEOFENCE_RADII_FEET, DEFAULT_JOBSITE_TIME_SETTINGS } from '@/lib/jobsite-time/domain';

// CEO/Admin-only company settings for Automatic Jobsite Time. Rendered inside the
// consolidated Settings page for admins.
export function JobsiteTimeSettingsCard() {
  const [settings, setSettings] = useState<any>(DEFAULT_JOBSITE_TIME_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/jobsite-time/settings', { cache: 'no-store' });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.item) setSettings(json.item);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (patch: Record<string, unknown>) => {
    setSaving(true);
    setMsg('');
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      const res = await fetch('/api/jobsite-time/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.item) {
        setSettings(json.item);
        setMsg('Saved.');
      } else {
        setMsg(json?.error || 'Failed to save.');
      }
    } catch {
      setMsg('Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const Toggle = ({ label, k, help }: { label: string; k: string; help?: string }) => (
    <label className="flex items-start justify-between gap-3 py-2">
      <span>
        <span className="text-sm font-medium text-gray-800 dark:text-zinc-200">{label}</span>
        {help && <span className="mt-0.5 block text-xs text-gray-500 dark:text-zinc-500">{help}</span>}
      </span>
      <input
        type="checkbox"
        checked={Boolean(settings[k])}
        disabled={saving || loading}
        onChange={(e) => save({ [k]: e.target.checked })}
        className="mt-0.5 h-5 w-5 shrink-0 accent-brand-500"
      />
    </label>
  );

  const num = 'rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-[#050505] dark:text-zinc-100';

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-zinc-800 dark:bg-[#090909]">
      <h3 className="font-semibold text-gray-900 dark:text-zinc-100">Automatic Jobsite Time</h3>
      <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">
        Turn assigned-job jobsite arrival/departure into reviewable timecards. Location is only used during assigned
        shifts — no continuous tracking, no employee map.
      </p>

      <div className="mt-3 divide-y divide-gray-100 dark:divide-zinc-800">
        <Toggle label="Enable Automatic Jobsite Time" k="enabled" />
        <Toggle label="Require manager approval before hours count" k="requireApproval" />
        <div className="flex items-center justify-between gap-3 py-2">
          <span className="text-sm font-medium text-gray-800 dark:text-zinc-200">Geofence radius</span>
          <select
            value={settings.geofenceRadiusFeet}
            disabled={saving || loading}
            onChange={(e) => save({ geofenceRadiusFeet: Number(e.target.value) })}
            className={num}
          >
            {ALLOWED_GEOFENCE_RADII_FEET.map((r) => (
              <option key={r} value={r}>{r} ft</option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-between gap-3 py-2">
          <span className="text-sm font-medium text-gray-800 dark:text-zinc-200">Ignore short departures under (min)</span>
          <input type="number" min={0} max={120} value={settings.ignoreShortDepartureMinutes} disabled={saving || loading}
            onChange={(e) => save({ ignoreShortDepartureMinutes: Number(e.target.value) })} className={`${num} w-20 text-right`} />
        </div>
        <div className="flex items-center justify-between gap-3 py-2">
          <span className="text-sm font-medium text-gray-800 dark:text-zinc-200">Departures over (min) → break / review</span>
          <input type="number" min={0} max={240} value={settings.breakThresholdMinutes} disabled={saving || loading}
            onChange={(e) => save({ breakThresholdMinutes: Number(e.target.value) })} className={`${num} w-20 text-right`} />
        </div>
        <Toggle label="Auto clock out after leaving past scheduled end" k="autoClockOutAfterEnd" />
        <Toggle label="Manual clock-in fallback enabled" k="manualFallbackEnabled" />
      </div>
      {msg && <p className="mt-2 text-xs text-gray-500 dark:text-zinc-400">{msg}</p>}
    </div>
  );
}
