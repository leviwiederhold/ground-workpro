'use client';

// The ONE place Groundwork Pro asks for location.
//
// Rendered after authentication and INSTEAD OF all application content until
// setup completes, so the dashboard never briefly appears behind it and nothing
// behind it is interactive. There is no secondary action, no "Not now", no close
// control, no backdrop dismissal and no Escape handler — exactly one way forward.
//
// The enable flow is a bounded state machine (runLocationSetup): the native
// permission request and the device-credential enrollment are each time-bounded,
// so a step that never resolves (the stuck "Requesting…" bug) can no longer pin
// the button — it falls back to a concise, recoverable error and the button
// returns to "Enable Location".

import { useCallback, useEffect, useState } from 'react';
import {
  checkLocationPermission,
  requestLocationPermissionInteractive,
  type LocationPermissionResult,
  type LocationPermissionState,
} from '@/lib/jobsite-time/locationPermission';
import {
  LOCATION_GATE_COPY,
  LOCATION_GATE_ERROR_COPY,
  locationSetupErrorKind,
  resolveGateAction,
  resolveGateBody,
  resolveGateButtonLabel,
  runLocationSetup,
  type LocationSetupErrorKind,
} from '@/lib/jobsite-time/locationGate';
import { locationSettingsInstructions, openAppLocationSettings } from '@/lib/runtime/openAppSettings';
import { isCapacitorNativePlatform } from '@/lib/runtime/isNativePlatform';
import { getNativeGeofenceHealth } from '@/lib/attendance/nativeGeofence';
import { enrollDeviceCredential } from '@/lib/attendance/deviceCredentialClient';

export function LocationRequiredGate({ onGranted }: { onGranted: () => void }) {
  const [permission, setPermission] = useState<LocationPermissionState | 'checking'>('checking');
  const [lastResult, setLastResult] = useState<LocationPermissionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  // Non-denial failure (timeout / enrollment / unavailable) → a concise message.
  // Denial is communicated by the body + "Open Settings", so it stays null there.
  const [errorKind, setErrorKind] = useState<LocationSetupErrorKind | null>(null);

  // Read the current state so the button can offer "Try Again" vs "Open
  // Settings" correctly on first paint. This is the NON-prompting check — the
  // OS dialog is only ever raised by the user's tap below.
  useEffect(() => {
    let active = true;
    checkLocationPermission()
      .then((state) => {
        if (active) setPermission(state);
      })
      .catch(() => {
        /* the button still works; leave permission as 'checking' */
      });
    return () => {
      active = false;
    };
  }, []);

  // While the gate is mounted, nothing behind it should scroll.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const action = resolveGateAction({ permission, lastResult });
  const native = isCapacitorNativePlatform();

  // Setup is complete when location is granted AND, on native only, a device
  // credential is enrolled. Web has no secure store, so it requires only
  // permission — never a credential, which would lock web users out. Idempotent:
  // an existing credential is reused rather than re-minted on every tap/return.
  const completeSetup = useCallback(async (): Promise<boolean> => {
    if (!native) return true;
    const health = await getNativeGeofenceHealth().catch(() => null);
    if (health?.hasCredential) return true;
    return enrollDeviceCredential();
  }, [native]);

  // Bounded "finish setup because permission is already granted" — reused by the
  // Settings-return and focus paths so the credential step is time-bounded there
  // too.
  const finishGrantedSetup = useCallback(
    () => runLocationSetup({ requestPermission: async () => 'granted', completeSetup }),
    [completeSetup],
  );

  const handlePrimary = useCallback(async () => {
    if (action === 'settings') {
      const outcome = openAppLocationSettings();
      // Browsers cannot open site settings programmatically — show the manual
      // steps rather than a button that appears to do nothing.
      if (outcome === 'unsupported') setShowInstructions(true);
      // Re-read on return: the user may have granted it in Settings.
      const next = await checkLocationPermission().catch(() => 'unavailable' as LocationPermissionState);
      setPermission(next);
      if (next === 'granted') {
        setBusy(true);
        setErrorKind(null);
        try {
          const result = await finishGrantedSetup();
          if (result.status === 'granted') onGranted();
          else setErrorKind(locationSetupErrorKind(result));
        } finally {
          setBusy(false);
        }
      }
      return;
    }

    setBusy(true);
    setErrorKind(null);
    try {
      // Both steps are bounded inside runLocationSetup, so this always settles —
      // the button can never be stranded on "Requesting…".
      const result = await runLocationSetup({
        requestPermission: requestLocationPermissionInteractive,
        completeSetup,
      });
      if (result.status === 'granted') {
        onGranted();
        return;
      }
      if (result.status === 'denied') {
        // Communicated by the body switching + the "Open Settings" action.
        setLastResult('denied');
        setPermission(await checkLocationPermission().catch(() => 'denied' as LocationPermissionState));
        return;
      }
      // timeout | unavailable | enrollment_failed → concise recoverable message,
      // button returns to "Enable Location".
      setErrorKind(locationSetupErrorKind(result));
    } finally {
      setBusy(false);
    }
  }, [action, completeSetup, finishGrantedSetup, onGranted]);

  // Re-check when the app returns to the foreground: the user may have enabled
  // location in Settings and come back. Bounded, and silent on failure (this is
  // a background re-check, not a tap).
  useEffect(() => {
    const onFocus = async () => {
      const next = await checkLocationPermission().catch(() => 'unavailable' as LocationPermissionState);
      setPermission(next);
      if (next === 'granted') {
        const result = await finishGrantedSetup();
        if (result.status === 'granted') onGranted();
      }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [onGranted, finishGrantedSetup]);

  const label = resolveGateButtonLabel({ action, lastResult });
  const body = resolveGateBody(lastResult);

  return (
    <main
      className="fixed inset-0 z-[200] flex items-center justify-center bg-gray-50 p-6 dark:bg-[#050505]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="location-gate-title"
      data-testid="location-required-gate"
    >
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-[#0b0b0b]">
        {/* Proper location icon from Font Awesome (loaded globally via
            globals.css) — a map pin above the title. No image asset added. */}
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
          <i className="fa-solid fa-location-dot text-2xl" aria-hidden="true" data-testid="location-gate-icon" />
        </div>

        <h1 id="location-gate-title" className="text-xl font-semibold text-gray-900 dark:text-zinc-100">
          {LOCATION_GATE_COPY.title}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-gray-600 dark:text-zinc-400" data-testid="location-gate-body">
          {body}
        </p>

        {showInstructions ? (
          <p
            className="mt-4 rounded-xl bg-amber-50 p-3 text-left text-xs leading-relaxed text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
            data-testid="location-gate-instructions"
          >
            {locationSettingsInstructions(native)}
          </p>
        ) : null}

        {errorKind ? (
          <p
            className="mt-4 rounded-xl bg-amber-50 p-3 text-left text-xs leading-relaxed text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
            data-testid="location-gate-error"
          >
            {LOCATION_GATE_ERROR_COPY[errorKind]}
          </p>
        ) : null}

        <button
          type="button"
          onClick={handlePrimary}
          disabled={busy}
          className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          data-testid="location-gate-primary"
        >
          {busy ? 'Requesting…' : label}
        </button>
      </div>
    </main>
  );
}
