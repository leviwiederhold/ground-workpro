'use client';

// The single place location is enforced for authenticated app content.
//
// Rule: location is required to USE Groundwork Pro ONLY for users who
// participate in automatic jobsite attendance (field crew). CEO/admin and other
// management/office roles are NOT gated merely for being authenticated.
//
//   Wrapped   → /, /settings, /profile, /notifications
//   NOT wrapped → /setup, /login, native onboarding, auth callbacks, and the
//                 public invite steps that must happen before setup.
//
// Behaviour (identical on every wrapped route):
//   checking → render NOTHING, so protected content never flashes before the
//              answer is known, and the gate never flashes for granted users
//   blocked  → render the gate INSTEAD of the route's content
//   granted  → render the route (setup complete, or the user is not a participant)
//
// "Setup complete" is derived from live signals every time — never a local
// completion flag. On web that is location permission; on native it is
// permission AND an enrolled device credential (background events need it).
//
// Permission is re-checked when the window regains focus or becomes visible, so
// revoking it in OS/browser settings while signed in raises the gate on return
// rather than leaving a granted-looking session behind.

import { useCallback, useEffect, useState } from 'react';
import { checkLocationPermission } from '@/lib/jobsite-time/locationPermission';
import {
  isAttendanceSetupComplete,
  LOCATION_CHECK_TIMEOUT_MS,
  participatesInAutomaticAttendance,
  resolveGateStatusWithTimeout,
  type GatePlatform,
  type LocationGateStatus,
} from '@/lib/jobsite-time/locationGate';
import { readCachedUiRole } from '@/lib/nav/navCache';
import { isCapacitorNativePlatform } from '@/lib/runtime/isNativePlatform';
import { getNativeGeofenceHealth } from '@/lib/attendance/nativeGeofence';
import { LocationRequiredGate } from './LocationRequiredGate';

export function RequireLocationAccess({
  role,
  children,
}: {
  /** Already-hydrated UI role. When omitted, the cached nav role is used — no
   *  extra bootstrap fetch either way. */
  role?: string | null;
  children: React.ReactNode;
}) {
  const [status, setStatus] = useState<LocationGateStatus>('checking');

  // Combined, non-prompting evaluation of whether attendance setup is complete.
  // Reads permission and — on native only — the device-credential health. On
  // web the credential is not required, so web users are never locked out.
  const evaluate = useCallback(async (): Promise<LocationGateStatus> => {
    const permission = await checkLocationPermission();
    const platform: GatePlatform = isCapacitorNativePlatform() ? 'native' : 'web';
    let hasDeviceCredential = true;
    if (platform === 'native') {
      const health = await getNativeGeofenceHealth().catch(() => null);
      hasDeviceCredential = Boolean(health?.hasCredential);
    }
    return isAttendanceSetupComplete({ platform, permission, hasDeviceCredential }) ? 'granted' : 'blocked';
  }, []);

  // Non-participants (CEO/admin, office) are never gated. Participation is read
  // from already-hydrated role state, so being authenticated alone never gates.
  const isParticipant = useCallback(() => participatesInAutomaticAttendance(role ?? readCachedUiRole()), [role]);

  useEffect(() => {
    let active = true;
    if (!isParticipant()) {
      setStatus('granted');
      return () => {
        active = false;
      };
    }
    // Bound the evaluation: a stalled check (the physical-iPhone white screen,
    // where the Capacitor plugin import / bridge call can hang) resolves to
    // 'blocked', so the setup gate shows instead of a blank screen. No redirect
    // or reload — the gate is recoverable in place.
    resolveGateStatusWithTimeout(evaluate, LOCATION_CHECK_TIMEOUT_MS).then((next) => {
      if (active) setStatus(next);
    });
    return () => {
      active = false;
    };
  }, [isParticipant, evaluate]);

  // Re-check on focus/visibility. Covers BOTH directions: completing setup in
  // Settings and coming back lets the user in, and revoking there raises the
  // gate on an already-signed-in session.
  const sync = useCallback(async () => {
    if (!isParticipant()) {
      setStatus('granted');
      return;
    }
    setStatus(await evaluate());
  }, [isParticipant, evaluate]);

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
