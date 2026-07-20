/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import {
  ALLOWED_ARRIVAL_CONFIRMATION_SECONDS,
  ALLOWED_DEPARTURE_GRACE_MINUTES,
  ALLOWED_WAKE_RADII_METERS,
  wakeRadiusLabel,
} from '@/lib/jobsite-time/domain';

// CEO/Admin-only Attendance tuning. CONTROLLED by the Settings page: it renders
// no Save button and never fetches or autosaves — its values and changes flow
// through the parent so everything is committed by the single page-level
// "Save Changes" action.
//
// There is intentionally NO enable/disable toggle: Attendance is permanent for
// every company. The jobsite geofence radius is edited in the company work-hours
// section (setup parity), so it is not duplicated here.
export function JobsiteTimeSettingsCard({
  values,
  onChange,
  disabled,
}: {
  values: any;
  onChange: (patch: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  const settings = values ?? {};

  const Toggle = ({ label, k, help }: { label: string; k: string; help?: string }) => (
    <label className="flex items-start justify-between gap-3 py-2">
      <span>
        <span className="text-sm font-medium text-gray-800 dark:text-zinc-200">{label}</span>
        {help && <span className="mt-0.5 block text-xs text-gray-500 dark:text-zinc-500">{help}</span>}
      </span>
      <input
        type="checkbox"
        checked={Boolean(settings[k])}
        disabled={disabled}
        onChange={(e) => onChange({ [k]: e.target.checked })}
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
    <div>
      <h3 className="font-semibold text-gray-900 dark:text-zinc-100">Attendance</h3>
      <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">
        Automatically detect arrivals and departures at assigned jobs. Location is only used during assigned
        shifts — no continuous tracking, no employee map. Attendance is always on.
      </p>

      <div className="mt-3 divide-y divide-gray-100 dark:divide-zinc-800">
        <Row label="Wake radius" help="Wide zone that starts closer monitoring. Doesn't mark arrival by itself.">
          <select
            value={settings.wakeRadiusMeters}
            disabled={disabled}
            onChange={(e) => onChange({ wakeRadiusMeters: Number(e.target.value) })}
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

        <Row label="Departure grace period" help="How long an employee must be gone before they're marked left.">
          <select
            value={settings.departureGraceMinutes}
            disabled={disabled}
            onChange={(e) => onChange({ departureGraceMinutes: Number(e.target.value) })}
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
            disabled={disabled}
            onChange={(e) => onChange({ arrivalConfirmationSeconds: Number(e.target.value) })}
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
    </div>
  );
}
