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

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  checkNativeLocationPermission,
  checkLocationPermission,
  loadCapacitorGeolocation,
  requestNativeLocationPermissionFromPrompt,
  requestLocationPermissionInteractive,
  type LocationPermissionResult,
  type LocationPermissionState,
} from '@/lib/jobsite-time/locationPermission';
import {
  LOCATION_GATE_COPY,
  LOCATION_GATE_ERROR_COPY,
  locationSetupErrorKind,
  isAttendanceSetupComplete,
  resolveGateAction,
  resolveGateBody,
  resolveGateButtonLabel,
  runLocationSetup,
  type LocationSetupErrorKind,
  type LocationSetupTransition,
} from '@/lib/jobsite-time/locationGate';
import { locationSettingsInstructions, openAppLocationSettings } from '@/lib/runtime/openAppSettings';
import { isCapacitorNativePlatform } from '@/lib/runtime/isNativePlatform';
import {
  getRegisteredGeofences,
  requestNativeAlwaysAuthorization,
  requireNativeGeofenceHealth,
  requireRegisteredGeofences,
} from '@/lib/attendance/nativeGeofence';
import { fetchAssignedJobsRequired } from '@/lib/jobsite-time/geofence-client';
import { loadAssignedAttendanceRegions } from '@/lib/attendance/assignedRegionsClient';
import { persistNativeAttendanceReadiness } from '@/lib/attendance/backgroundLocationClient';
import {
  hasActiveDeviceCredential,
  requestDeviceCredential,
  writeDeviceCredentialToSecureStore,
  type DeviceCredentialPayload,
} from '@/lib/attendance/deviceCredentialClient';

export function LocationRequiredGate({ onGranted }: { onGranted: () => void }) {
  const [permission, setPermission] = useState<LocationPermissionState | 'checking'>('checking');
  const [lastResult, setLastResult] = useState<LocationPermissionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [settingsRequired, setSettingsRequired] = useState(false);
  // Non-denial failure (timeout / enrollment / unavailable) → a concise message.
  // Denial is communicated by the body + "Open Settings", so it stays null there.
  const [errorKind, setErrorKind] = useState<LocationSetupErrorKind | null>(null);
  // React state updates are asynchronous. This ref is the synchronous lock that
  // prevents a second tap from starting another native permission/enrollment
  // attempt before the disabled button has rendered.
  const setupInFlight = useRef(false);

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

  const action = settingsRequired
    ? 'settings'
    : resolveGateAction({ permission, lastResult });
  const native = isCapacitorNativePlatform();

  const reportTransition = useCallback((transition: LocationSetupTransition) => {
    console.info('[location/setup]', transition.state, transition.stage);
  }, []);

  const loadRequiredRegions = useCallback(async () => {
    return loadAssignedAttendanceRegions(await fetchAssignedJobsRequired());
  }, []);

  /**
   * One dependency-injected pipeline for tap and foreground return. Native
   * permission check/request, geofence bridge, network enrollment, Keychain
   * write and final verification remain separately timed and reported.
   */
  const performSetup = useCallback(
    (interactive: boolean) =>
      runLocationSetup<DeviceCredentialPayload>({
        native,
        checkPermission: async () => {
          if (!native) return checkLocationPermission();
          return checkNativeLocationPermission(await loadCapacitorGeolocation());
        },
        requestPermission: async () => {
          if (!interactive) return 'unavailable';
          if (!native) return requestLocationPermissionInteractive();
          return requestNativeLocationPermissionFromPrompt(await loadCapacitorGeolocation());
        },
        checkNativeGeofenceHealth: async () => {
          const health = await requireNativeGeofenceHealth();
          if (!health.hasCredential) return health;
          return {
            ...health,
            hasCredential: await hasActiveDeviceCredential(),
          };
        },
        requestBackgroundAuthorization: interactive
          ? requestNativeAlwaysAuthorization
          : async () => {},
        enrollSecureCredential: (signal) => requestDeviceCredential('ios', signal),
        writeSecureCredential: writeDeviceCredentialToSecureStore,
        registerAssignedLocations: async () =>
          requireRegisteredGeofences(await loadRequiredRegions()),
        verifyCompletion: async () => {
          const finalPermission = native
            ? await checkNativeLocationPermission(await loadCapacitorGeolocation())
            : await checkLocationPermission();
          if (finalPermission !== 'granted') return false;
          if (!native) return true;
          const [health, requiredRegions, registered] = await Promise.all([
            requireNativeGeofenceHealth(),
            loadRequiredRegions(),
            getRegisteredGeofences(),
          ]);
          const hasActiveCredential =
            health.hasCredential && await hasActiveDeviceCredential();
          const complete = isAttendanceSetupComplete({
            platform: 'native',
            permission: finalPermission,
            hasDeviceCredential: hasActiveCredential,
            nativeHealth: health,
            requiredRegionIds: requiredRegions.map((region) => region.identifier),
            registeredRegionIds: registered.map((region) => region.identifier),
          });
          await persistNativeAttendanceReadiness(health, complete, {
            requiredRegionIds: requiredRegions.map((region) => region.identifier),
            registeredRegionIds: registered.map((region) => region.identifier),
          });
          return complete;
        },
        onTransition: reportTransition,
      }),
    [loadRequiredRegions, native, reportTransition],
  );

  const handlePrimary = useCallback(async () => {
    if (action === 'settings') {
      // Always show the manual path as well. `window.open` can be accepted by
      // the WebView without proving that iOS displayed Settings.
      setShowInstructions(true);
      openAppLocationSettings();
      // Do not immediately re-check: the app is only beginning to background
      // and the user has not had a chance to change the setting yet. The
      // bounded foreground listener below finishes setup on return.
      return;
    }

    if (setupInFlight.current) return;
    setupInFlight.current = true;
    // This update happens before any awaited operation, so the first render
    // after a valid tap says "Requesting…".
    setBusy(true);
    setErrorKind(null);
    setSettingsRequired(false);
    try {
      const result = await performSetup(true);
      if (result.status === 'granted') {
        onGranted();
        return;
      }
      if (result.status === 'denied') {
        // Communicated by the body switching + the "Open Settings" action.
        setLastResult('denied');
        // The native request result is authoritative. Do not make another
        // unbounded bridge call here: that was a remaining path that could pin
        // the button on "Requesting…" after a denial.
        setPermission('denied');
        setSettingsRequired(true);
        setShowInstructions(true);
        return;
      }
      if (result.status === 'settings_required') {
        setPermission('granted');
        setSettingsRequired(true);
        setShowInstructions(true);
        return;
      }
      console.error('[location/setup] failed', result.code, result.stage, result.detail ?? '');
      setErrorKind(locationSetupErrorKind(result));
    } finally {
      setupInFlight.current = false;
      setBusy(false);
    }
  }, [action, onGranted, performSetup]);

  // Re-check when the app returns to the foreground: the user may have enabled
  // location in Settings and come back. Bounded, and silent on failure (this is
  // a background re-check, not a tap).
  useEffect(() => {
    const onFocus = async () => {
      // The OS permission sheet itself emits focus/visibility transitions.
      // Never let those launch enrollment alongside the tap-owned attempt.
      if (setupInFlight.current) return;
      setupInFlight.current = true;
      try {
        const result = await performSetup(false);
        if (result.status === 'granted') onGranted();
        if (result.status === 'settings_required' || result.status === 'denied') {
          setSettingsRequired(true);
          setShowInstructions(true);
        }
      } finally {
        setupInFlight.current = false;
      }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [onGranted, performSetup]);

  const label = resolveGateButtonLabel({ action, lastResult });
  const body = settingsRequired
    ? LOCATION_GATE_COPY.deniedBody
    : resolveGateBody(lastResult);

  return (
    <main
      className="fixed inset-0 z-[200] flex items-center justify-center bg-gray-50 p-6 dark:bg-[#050505]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="location-gate-title"
      data-testid="location-required-gate"
    >
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-[#0b0b0b]">
        {/* Inline SVG ships inside the remote page's JS/HTML. It cannot disappear
            when the TestFlight WebView misses a global icon-font stylesheet. */}
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-7 w-7"
            aria-hidden="true"
            data-testid="location-gate-icon"
          >
            <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
            <circle cx="12" cy="10" r="2.5" />
          </svg>
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
