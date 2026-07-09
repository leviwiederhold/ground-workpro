'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  checkLocationPermission,
  requestLocationPermissionInteractive,
  resolveLocationGateView,
  type LocationPermissionState,
} from '@/lib/jobsite-time/locationPermission';

// Attendance location gate. Wraps the clock-in/out flow: location permission is
// required to clock in or out, but it is NOT a dashboard-wide block — this only
// gates the attendance action it wraps.
//
//   granted     → renders {children} (the clock-in/out controls)
//   prompt      → iOS-style pre-permission card ("Allow While Using App")
//   denied      → blocked state with OS/browser settings instructions
//   unavailable → specific "location unavailable" error
//
// The custom card is only a PRE-permission screen; the real Apple/browser
// permission dialog is triggered by the actual geolocation call fired from the
// user's "Allow While Using App" tap.
export function LocationPermissionGate({
  children,
  onGranted,
  onNotNow,
}: {
  children: React.ReactNode;
  onGranted?: () => void;
  onNotNow?: () => void;
}) {
  const [state, setState] = useState<LocationPermissionState | 'checking'>('checking');
  const [requesting, setRequesting] = useState(false);

  const runCheck = useCallback(async () => {
    const s = await checkLocationPermission();
    console.info('[attendance/location] permission state', s);
    setState(s);
    if (s === 'granted') onGranted?.();
  }, [onGranted]);

  useEffect(() => {
    runCheck();
  }, [runCheck]);

  const allow = useCallback(async () => {
    setRequesting(true);
    try {
      const result = await requestLocationPermissionInteractive();
      console.info('[attendance/location] permission request result', result);
      setState(result);
      if (result === 'granted') onGranted?.();
    } finally {
      setRequesting(false);
    }
  }, [onGranted]);

  const view = resolveLocationGateView(state);

  if (view === 'checking') {
    return <p className="py-4 text-center text-sm text-gray-500 dark:text-zinc-400">Checking location access…</p>;
  }

  if (view === 'clock-in') {
    return <>{children}</>;
  }

  const shell = 'rounded-2xl border border-gray-200 bg-white p-5 text-center dark:border-zinc-800 dark:bg-[#0b0b0b]';

  if (view === 'unavailable') {
    return (
      <div className={shell} data-testid="location-unavailable">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400">
          <i className="fa-solid fa-location-crosshairs text-xl" />
        </div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-zinc-100">Location isn&apos;t available on this device</h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">
          Your device or browser doesn&apos;t support location services, so attendance can&apos;t verify you&apos;re at the
          jobsite. Try the Groundwork Pro app on your phone, or ask your manager to clock you in manually.
        </p>
        <button
          type="button"
          onClick={runCheck}
          className="mt-4 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-[#111]"
        >
          Try again
        </button>
      </div>
    );
  }

  if (view === 'blocked') {
    return (
      <div className={shell} data-testid="location-blocked">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400">
          <i className="fa-solid fa-location-dot text-xl" />
        </div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-zinc-100">Location access is turned off</h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">
          Location is required to clock in or out. Turn it back on for Groundwork Pro:
        </p>
        <ul className="mx-auto mt-3 max-w-xs space-y-1 text-left text-xs text-gray-500 dark:text-zinc-400">
          <li><strong className="text-gray-700 dark:text-zinc-200">iPhone:</strong> Settings → Privacy &amp; Security → Location Services → Groundwork Pro → While Using the App.</li>
          <li><strong className="text-gray-700 dark:text-zinc-200">Android:</strong> Settings → Apps → Groundwork Pro → Permissions → Location → Allow.</li>
          <li><strong className="text-gray-700 dark:text-zinc-200">Browser:</strong> tap the address-bar site settings → Location → Allow, then reload.</li>
        </ul>
        <button
          type="button"
          onClick={runCheck}
          className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          I&apos;ve enabled it
        </button>
      </div>
    );
  }

  // view === 'pre-permission' — iOS-style pre-permission card.
  return (
    <div className={shell} data-testid="location-pre-permission">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
        <i className="fa-solid fa-location-arrow text-xl" />
      </div>
      <h3 className="text-base font-semibold text-gray-900 dark:text-zinc-100">
        Allow &quot;Groundwork Pro&quot; to use your location?
      </h3>
      <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">
        Your location is used to verify you are at the job site when clocking in or out.
      </p>
      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          onClick={allow}
          disabled={requesting}
          className="w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          data-testid="location-allow"
        >
          {requesting ? 'Requesting…' : 'Allow While Using App'}
        </button>
        <button
          type="button"
          onClick={() => onNotNow?.()}
          disabled={requesting}
          className="w-full rounded-xl px-4 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-60 dark:text-zinc-300 dark:hover:bg-[#111]"
          data-testid="location-not-now"
        >
          Not Now
        </button>
      </div>
    </div>
  );
}
