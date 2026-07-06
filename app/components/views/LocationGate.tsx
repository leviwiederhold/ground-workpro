'use client';

import { useCallback, useEffect, useState } from 'react';
import { isNativeAppRuntime } from '@/lib/runtime/isNativeApp';
import { requestJobsiteLocationPermission } from '@/lib/jobsite-time/geofence-client';

// Roles that manage from the web dashboard and must NOT be blocked by the
// location requirement. Everyone else (field employees) is a candidate for the
// gate — but only inside the native app, never on desktop web.
const MANAGER_ROLES = new Set(['executive', 'operations', 'pm', 'admin', 'manager', 'ceo']);

type PermState = 'unknown' | 'granted' | 'denied' | 'prompt' | 'unavailable';

// Blocking Location Services screen for field employees in the native app.
// Renders nothing (children pass through) unless the gate applies AND location
// is not granted. It never blocks managers or desktop web.
export function LocationGate({ role }: { role?: string | null }) {
  const [perm, setPerm] = useState<PermState>('unknown');
  const [checking, setChecking] = useState(true);
  const [requesting, setRequesting] = useState(false);

  const shouldGate = isNativeAppRuntime() && !MANAGER_ROLES.has(String(role || '').trim().toLowerCase());

  const check = useCallback(async () => {
    if (!shouldGate) {
      setChecking(false);
      return;
    }
    setChecking(true);
    try {
      if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
        const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
        setPerm((status.state as PermState) ?? 'prompt');
      } else if (typeof navigator !== 'undefined' && navigator.geolocation) {
        setPerm('prompt');
      } else {
        setPerm('unavailable');
      }
    } catch {
      setPerm('unavailable');
    } finally {
      setChecking(false);
    }
  }, [shouldGate]);

  useEffect(() => { check(); }, [check]);

  const enable = async () => {
    setRequesting(true);
    try {
      const result = await requestJobsiteLocationPermission();
      if (result === 'granted') {
        setPerm('granted');
      } else if (result === 'denied') {
        setPerm('denied');
      } else {
        // 'prompt'/'unavailable' — try a live position request to force the OS
        // dialog, then re-check the resolved permission.
        if (typeof navigator !== 'undefined' && navigator.geolocation) {
          await new Promise<void>((resolve) => {
            navigator.geolocation.getCurrentPosition(
              () => { setPerm('granted'); resolve(); },
              () => { setPerm('denied'); resolve(); },
              { timeout: 10000 }
            );
          });
        } else {
          setPerm(result === 'unavailable' ? 'unavailable' : 'prompt');
        }
      }
    } finally {
      setRequesting(false);
    }
  };

  // Pass through when the gate doesn't apply, while checking, when granted, or
  // when we genuinely can't detect location support (never lock a user out on a
  // detection failure).
  if (!shouldGate || checking || perm === 'granted' || perm === 'unavailable') return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-white p-6 dark:bg-[#050505]" data-testid="location-gate">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
          <i className="fa-solid fa-location-dot text-2xl" />
        </div>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-zinc-100">
          Groundwork Pro requires Location Services to continue.
        </h1>
        <button
          type="button"
          onClick={enable}
          disabled={requesting}
          className="mt-6 w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          data-testid="location-gate-enable"
        >
          {requesting ? 'Enabling…' : 'Enable Location'}
        </button>
        {perm === 'denied' && (
          <p className="mt-4 text-sm text-gray-500 dark:text-zinc-400">
            Location Services must be enabled to use Groundwork Pro.
          </p>
        )}
      </div>
    </div>
  );
}
