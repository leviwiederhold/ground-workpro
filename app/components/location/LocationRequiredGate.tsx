'use client';

// The ONE place Groundwork Pro asks for location.
//
// Rendered after authentication and INSTEAD OF all application content until
// permission is granted, so the dashboard never briefly appears behind it and
// nothing behind it is interactive. There is no secondary action, no "Not now",
// no close control, no backdrop dismissal and no Escape handler — location is a
// prerequisite for entering the app, so the gate has exactly one way forward.
//
// Platform logic is NOT reimplemented here: requestLocationPermissionInteractive
// already branches to the Capacitor Geolocation plugin inside the native app and
// to navigator.geolocation.getCurrentPosition on the web.

import { useCallback, useEffect, useState } from 'react';
import {
  checkLocationPermission,
  requestLocationPermissionInteractive,
  type LocationPermissionResult,
  type LocationPermissionState,
} from '@/lib/jobsite-time/locationPermission';
import {
  LOCATION_GATE_COPY,
  resolveGateAction,
  resolveGateBody,
  resolveGateButtonLabel,
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
  // Set when location is granted but native device-credential enrollment failed
  // — the one case where "Allow" succeeded yet setup is not complete.
  const [setupError, setSetupError] = useState(false);

  // Read the current state so the button can offer "Try Again" vs "Open
  // Settings" correctly on first paint. This is the NON-prompting check — the
  // OS dialog is only ever raised by the user's tap below.
  useEffect(() => {
    let active = true;
    checkLocationPermission().then((state) => {
      if (active) setPermission(state);
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
  // credential is enrolled (background attendance events need it). Web has no
  // secure store, so it requires only permission — never a credential, which
  // would lock web users out permanently. Idempotent: an existing credential is
  // reused rather than re-minted on every tap/return.
  const completeSetup = useCallback(async (): Promise<boolean> => {
    if (!native) return true;
    const health = await getNativeGeofenceHealth().catch(() => null);
    if (health?.hasCredential) return true;
    return await enrollDeviceCredential();
  }, [native]);

  const handlePrimary = useCallback(async () => {
    if (action === 'settings') {
      const outcome = openAppLocationSettings();
      // Browsers cannot open site settings programmatically — show the manual
      // steps rather than a button that appears to do nothing.
      if (outcome === 'unsupported') setShowInstructions(true);
      // Re-read on return: the user may have granted it in Settings.
      const next = await checkLocationPermission();
      setPermission(next);
      if (next === 'granted') {
        const ready = await completeSetup();
        if (ready) onGranted();
        else setSetupError(true);
      }
      return;
    }

    setBusy(true);
    setSetupError(false);
    try {
      const result = await requestLocationPermissionInteractive();
      setLastResult(result);
      if (result === 'granted') {
        // Finish device setup (native credential enrollment) before entering.
        // Dismiss only when complete — no reload, no navigation.
        const ready = await completeSetup();
        if (ready) {
          onGranted();
          return;
        }
        setSetupError(true);
        return;
      }
      // Re-read so the next tap offers the right action.
      setPermission(await checkLocationPermission());
    } finally {
      setBusy(false);
    }
  }, [action, completeSetup, onGranted]);

  // Re-check when the app returns to the foreground: the user may have enabled
  // location in Settings and come back.
  useEffect(() => {
    const onFocus = async () => {
      const next = await checkLocationPermission();
      setPermission(next);
      if (next === 'granted') {
        const ready = await completeSetup();
        if (ready) onGranted();
      }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [onGranted, completeSetup]);

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
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
          <i className="fa-solid fa-location-arrow text-2xl" aria-hidden="true" />
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

        {setupError ? (
          <p
            className="mt-4 rounded-xl bg-amber-50 p-3 text-left text-xs leading-relaxed text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
            data-testid="location-gate-setup-error"
          >
            Location is on, but we couldn&apos;t finish setting up attendance on this device. Please try again.
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
