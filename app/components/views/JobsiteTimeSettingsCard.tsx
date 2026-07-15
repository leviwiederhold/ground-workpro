/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ALLOWED_ARRIVAL_RADII_FEET,
  ALLOWED_ARRIVAL_CONFIRMATION_SECONDS,
  ALLOWED_DEPARTURE_GRACE_MINUTES,
  ALLOWED_WAKE_RADII_METERS,
  DEFAULT_JOBSITE_TIME_SETTINGS,
  arrivalRadiusLabel,
  wakeRadiusLabel,
} from '@/lib/jobsite-time/domain';

// CEO/Admin-only company settings for Attendance. Rendered inside the
// consolidated Settings page for admins. Deliberately simple: only the
// controls a manager actually needs, in plain units (feet, miles, minutes).
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

  const Row = ({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) => (
    <div className="flex items-center justify-between gap-3 py-2">
      <span>
        <span className="text-sm font-medium text-gray-800 dark:text-zinc-200">{label}</span>
        {help && <span className="mt-0.5 block text-xs text-gray-500 dark:text-zinc-500">{help}</span>}
      </span>
      {children}
    </div>
  );

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-zinc-800 dark:bg-[#090909]">
      <h3 className="font-semibold text-gray-900 dark:text-zinc-100">Attendance</h3>
      <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">
        Automatically detect arrivals and departures at assigned jobs. Location is only used during assigned
        shifts — no continuous tracking, no employee map.
      </p>

      <div className="mt-3 divide-y divide-gray-100 dark:divide-zinc-800">
        <Toggle label="Enable Attendance" k="enabled" />

        <Row label="Wake radius" help="Wide zone that starts closer monitoring. Doesn't mark arrival by itself.">
          <select
            value={settings.wakeRadiusMeters}
            disabled={saving || loading}
            onChange={(e) => save({ wakeRadiusMeters: Number(e.target.value) })}
            className={num}
          >
            {!ALLOWED_WAKE_RADII_METERS.includes(Number(settings.wakeRadiusMeters) as never) && (
              <option value={settings.wakeRadiusMeters}>{wakeRadiusLabel(Number(settings.wakeRadiusMeters))} (current)</option>
            )}
            {ALLOWED_WAKE_RADII_METERS.map((m) => (
              <option key={m} value={m}>{wakeRadiusLabel(m)}</option>
            ))}
          </select>
        </Row>

        <Row label="Arrival radius" help="Employee must be inside this radius to count as arrived.">
          <select
            value={settings.arrivalRadiusFeet}
            disabled={saving || loading}
            onChange={(e) => save({ arrivalRadiusFeet: Number(e.target.value) })}
            className={num}
          >
            {!ALLOWED_ARRIVAL_RADII_FEET.includes(Number(settings.arrivalRadiusFeet) as never) && (
              <option value={settings.arrivalRadiusFeet}>{arrivalRadiusLabel(Number(settings.arrivalRadiusFeet))} (current)</option>
            )}
            {ALLOWED_ARRIVAL_RADII_FEET.map((f) => (
              <option key={f} value={f}>{arrivalRadiusLabel(f)}</option>
            ))}
          </select>
        </Row>

        <Row label="Departure grace period" help="How long an employee must be gone before they're marked left.">
          <select
            value={settings.departureGraceMinutes}
            disabled={saving || loading}
            onChange={(e) => save({ departureGraceMinutes: Number(e.target.value) })}
            className={num}
          >
            {!ALLOWED_DEPARTURE_GRACE_MINUTES.includes(Number(settings.departureGraceMinutes) as never) && (
              <option value={settings.departureGraceMinutes}>{settings.departureGraceMinutes} min (current)</option>
            )}
            {ALLOWED_DEPARTURE_GRACE_MINUTES.map((m) => (
              <option key={m} value={m}>{m} min</option>
            ))}
          </select>
        </Row>

        <Row label="Arrival confirmation delay" help="How long an employee must stay before they're marked arrived.">
          <select
            value={settings.arrivalConfirmationSeconds}
            disabled={saving || loading}
            onChange={(e) => save({ arrivalConfirmationSeconds: Number(e.target.value) })}
            className={num}
          >
            {!ALLOWED_ARRIVAL_CONFIRMATION_SECONDS.includes(Number(settings.arrivalConfirmationSeconds) as never) && (
              <option value={settings.arrivalConfirmationSeconds}>{settings.arrivalConfirmationSeconds} sec (current)</option>
            )}
            {ALLOWED_ARRIVAL_CONFIRMATION_SECONDS.map((s) => (
              <option key={s} value={s}>{s} sec</option>
            ))}
          </select>
        </Row>

        <Toggle label="Require manager approval before hours count" k="requireApproval" />
        <Toggle label="Manual clock-in fallback enabled" k="manualFallbackEnabled" />
      </div>
      {msg && <p className="mt-2 text-xs text-gray-500 dark:text-zinc-400">{msg}</p>}
    </div>
  );
}
