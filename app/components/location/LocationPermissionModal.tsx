'use client';

// Reusable location-permission modal, shared by web and Capacitor iOS.
//
// One component and one copy deck for both platforms: the platform difference
// lives entirely in requestLocationPermissionInteractive(), which already
// branches to the native Capacitor Geolocation plugin inside the app wrapper and
// to navigator.geolocation.getCurrentPosition on the web.
//
// Behaviour notes that matter:
//   - The OS/browser dialog is triggered by the user's tap on "Enable location".
//     Nothing here requests permission on mount, so the app never prompts on
//     launch.
//   - On success the modal closes immediately and calls onGranted. It never
//     navigates or reloads — the caller just continues with its action.
//   - On denial it explains how to re-enable, with platform-appropriate steps,
//     and offers "Try again".

import { useCallback, useState } from 'react';
import {
  requestLocationPermissionInteractive,
  type LocationPermissionResult,
} from '@/lib/jobsite-time/locationPermission';

export const LOCATION_MODAL_COPY = {
  title: 'Enable location access',
  body:
    'Groundwork Pro uses your location to improve attendance accuracy and confirm jobsite activity. ' +
    'Your location is only used when required for work features and is not continuously tracked.',
  primary: 'Enable location',
  secondary: 'Not now',
} as const;

function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
      .Capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

export function LocationPermissionModal({
  open,
  onGranted,
  onDismiss,
}: {
  open: boolean;
  /** Called after permission is granted. The modal is already closing; do NOT reload. */
  onGranted: () => void;
  /** "Not now", backdrop, or close. Caller records the session dismissal. */
  onDismiss: () => void;
}) {
  const [requesting, setRequesting] = useState(false);
  const [result, setResult] = useState<LocationPermissionResult | null>(null);

  const request = useCallback(async () => {
    setRequesting(true);
    try {
      // Fired from the user's tap, which is what surfaces the OS/browser dialog.
      const next = await requestLocationPermissionInteractive();
      setResult(next);
      if (next === 'granted') {
        // Close immediately; no navigation, no reload.
        setResult(null);
        onGranted();
      }
    } finally {
      setRequesting(false);
    }
  }, [onGranted]);

  const dismiss = useCallback(() => {
    setResult(null);
    onDismiss();
  }, [onDismiss]);

  if (!open) return null;

  const denied = result === 'denied';
  const unavailable = result === 'unavailable';
  const native = isNativeApp();

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="location-modal-title"
      data-testid="location-permission-modal"
      onClick={(event) => {
        if (event.target === event.currentTarget && !requesting) dismiss();
      }}
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-[#0b0b0b]">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
          <i className="fa-solid fa-location-arrow text-xl" aria-hidden="true" />
        </div>

        <h3
          id="location-modal-title"
          className="text-center text-base font-semibold text-gray-900 dark:text-zinc-100"
        >
          {LOCATION_MODAL_COPY.title}
        </h3>
        <p className="mt-2 text-center text-sm leading-relaxed text-gray-500 dark:text-zinc-400">
          {LOCATION_MODAL_COPY.body}
        </p>

        {denied ? (
          <div className="mt-4 rounded-xl bg-amber-50 p-3 dark:bg-amber-950/30" data-testid="location-denied">
            <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
              Location access is turned off
            </p>
            <p className="mt-1 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
              {native
                ? 'Open Settings → Privacy & Security → Location Services → Groundwork Pro, then choose "While Using the App".'
                : 'Open your browser’s site settings for this page (the icon in the address bar) → Location → Allow, then try again.'}
            </p>
          </div>
        ) : null}

        {unavailable ? (
          <div className="mt-4 rounded-xl bg-red-50 p-3 dark:bg-red-950/30" data-testid="location-unavailable">
            <p className="text-sm font-medium text-red-900 dark:text-red-200">
              Location isn&apos;t available on this device
            </p>
            <p className="mt-1 text-xs leading-relaxed text-red-800 dark:text-red-300">
              This device or browser doesn&apos;t support location services. Ask your manager to record your
              time manually.
            </p>
          </div>
        ) : null}

        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={request}
            disabled={requesting}
            className="w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            data-testid="location-enable"
          >
            {requesting
              ? 'Requesting…'
              : denied || unavailable
                ? 'Try again'
                : LOCATION_MODAL_COPY.primary}
          </button>
          <button
            type="button"
            onClick={dismiss}
            disabled={requesting}
            className="w-full rounded-xl px-4 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-60 dark:text-zinc-300 dark:hover:bg-[#111]"
            data-testid="location-not-now"
          >
            {LOCATION_MODAL_COPY.secondary}
          </button>
        </div>
      </div>
    </div>
  );
}
