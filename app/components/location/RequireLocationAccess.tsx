'use client';

// The single place location is enforced for authenticated app content.
//
// Rule: location is required to USE Groundwork Pro after onboarding is complete.
//
//   Wrapped   → /, /settings, /profile, /notifications
//   NOT wrapped → /setup, /login, native onboarding, auth callbacks, and the
//                 public invite steps that must happen before setup. An invited
//                 user has to be able to finish creating their account; the gate
//                 meets them the moment setup redirects them into the app.
//
// Behaviour (identical on every wrapped route):
//   checking → render NOTHING, so protected content never flashes before the
//              answer is known, and the gate never flashes for granted users
//   blocked  → render the gate INSTEAD of the route's content
//   granted  → render the route
//
// Permission is re-checked when the window regains focus or becomes visible, so
// revoking it in OS/browser settings while signed in raises the gate on return
// rather than leaving a granted-looking session behind.

import { useCallback, useEffect, useState } from 'react';
import { checkLocationPermission } from '@/lib/jobsite-time/locationPermission';
import { resolveLocationGateStatus, type LocationGateStatus } from '@/lib/jobsite-time/locationGate';
import { LocationRequiredGate } from './LocationRequiredGate';

export function RequireLocationAccess({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<LocationGateStatus>('checking');

  // Non-prompting read. The OS dialog is only ever raised by the user's tap
  // inside the gate.
  const sync = useCallback(async () => {
    try {
      setStatus(resolveLocationGateStatus(await checkLocationPermission()));
    } catch {
      setStatus('blocked');
    }
  }, []);

  useEffect(() => {
    let active = true;
    checkLocationPermission()
      .then((permission) => {
        if (active) setStatus(resolveLocationGateStatus(permission));
      })
      .catch(() => {
        if (active) setStatus('blocked');
      });
    return () => {
      active = false;
    };
  }, []);

  // Re-check on focus/visibility. This covers BOTH directions: granting in
  // Settings and coming back lets the user in, and revoking there raises the
  // gate on an already-signed-in session.
  useEffect(() => {
    const onFocus = () => void sync();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [sync]);

  if (status === 'checking') return null;
  if (status !== 'granted') {
    return <LocationRequiredGate onGranted={() => setStatus('granted')} />;
  }
  return <>{children}</>;
}
