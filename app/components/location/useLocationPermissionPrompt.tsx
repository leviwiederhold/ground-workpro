'use client';

// Gates a location-required action behind the permission modal.
//
// Usage:
//   const { ensureLocation, modal } = useLocationPermissionPrompt();
//   const onClockIn = async () => { if (!(await ensureLocation())) return; ...; };
//   return <>{modal}{buttons}</>;
//
// `ensureLocation()` resolves true only when permission is granted, so the
// caller's action stays blocked until location is actually available. The modal
// is rendered on demand — never on mount, and never on the dashboard — which is
// what keeps CEO/admin/manager users from seeing it unless they start a feature
// that needs location.

import { useCallback, useRef, useState } from 'react';
import { checkLocationPermission } from '@/lib/jobsite-time/locationPermission';
import { markLocationPromptDismissed } from '@/lib/jobsite-time/locationPromptSession';
import { LocationPermissionModal } from './LocationPermissionModal';

export function useLocationPermissionPrompt() {
  const [open, setOpen] = useState(false);
  // Resolver for the in-flight ensureLocation() call, settled when the user
  // grants or dismisses.
  const pending = useRef<((granted: boolean) => void) | null>(null);

  const settle = useCallback((granted: boolean) => {
    const resolve = pending.current;
    pending.current = null;
    setOpen(false);
    resolve?.(granted);
  }, []);

  const ensureLocation = useCallback(async (): Promise<boolean> => {
    // Non-prompting check first: if permission is already granted the user is
    // never interrupted.
    const current = await checkLocationPermission();
    if (current === 'granted') return true;

    return new Promise<boolean>((resolve) => {
      pending.current = resolve;
      setOpen(true);
    });
  }, []);

  const handleGranted = useCallback(() => settle(true), [settle]);

  const handleDismiss = useCallback(() => {
    // Remember the dismissal for this session only, so the modal stops
    // reappearing on its own — but the next explicit clock-in/out attempt still
    // asks, because ensureLocation() always prompts when not granted.
    if (typeof window !== 'undefined') {
      markLocationPromptDismissed(window.sessionStorage);
    }
    settle(false);
  }, [settle]);

  const modal = (
    <LocationPermissionModal open={open} onGranted={handleGranted} onDismiss={handleDismiss} />
  );

  return { ensureLocation, modal, isPrompting: open };
}
