'use client';

// The single place location is enforced for authenticated app content.
//
// Rule: location is required to USE Groundwork Pro ONLY for users who
// participate in automatic jobsite attendance. Participation is determined by
// ASSIGNMENT (job_employees, via the assigned-jobs endpoint) — NOT a role
// allowlist. An assigned PM is gated; a CEO/admin with no assignments is not.
// Being authenticated is never, by itself, a reason to demand location.
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
// The whole evaluation is time-bounded: a stalled check (the physical-iPhone
// white screen, where the Capacitor plugin import / bridge call can hang) can
// never leave the app rendering null forever — it falls back to the setup gate.

import { useCallback, useEffect, useState } from 'react';
import { checkLocationPermission } from '@/lib/jobsite-time/locationPermission';
import {
  isAttendanceParticipant,
  isAttendanceSetupComplete,
  LOCATION_CHECK_TIMEOUT_MS,
  resolveGateStatusWithTimeout,
  type GatePlatform,
  type LocationGateStatus,
} from '@/lib/jobsite-time/locationGate';
import { fetchAssignedJobs } from '@/lib/jobsite-time/geofence-client';
import { isCapacitorNativePlatform } from '@/lib/runtime/isNativePlatform';
import { getNativeGeofenceHealth } from '@/lib/attendance/nativeGeofence';
import { LocationRequiredGate } from './LocationRequiredGate';

export function RequireLocationAccess({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<LocationGateStatus>('checking');

  // Non-prompting evaluation of the gate status:
  //   1. Participation — assigned to at least one job? (fetchAssignedJobs returns
  //      [] on any failure, so a transient error means "not a participant" and
  //      the app renders; the focus re-check will gate a participant on retry.)
  //   2. If a participant, is attendance setup complete? Web needs permission;
  //      native needs permission AND an enrolled device credential.
  const evaluate = useCallback(async (): Promise<LocationGateStatus> => {
    const jobs = await fetchAssignedJobs();
    if (!isAttendanceParticipant({ assignedJobCount: jobs.length })) return 'granted';

    const permission = await checkLocationPermission();
    const platform: GatePlatform = isCapacitorNativePlatform() ? 'native' : 'web';
    let hasDeviceCredential = true;
    if (platform === 'native') {
      const health = await getNativeGeofenceHealth().catch(() => null);
      hasDeviceCredential = Boolean(health?.hasCredential);
    }
    return isAttendanceSetupComplete({ platform, permission, hasDeviceCredential }) ? 'granted' : 'blocked';
  }, []);

  useEffect(() => {
    let active = true;
    // Bound the evaluation so it can never leave the app rendering null forever.
    // A stall or failure resolves to 'blocked' (show the setup gate) rather than
    // a blank screen. No redirect or reload — the gate is recoverable in place.
    resolveGateStatusWithTimeout(evaluate, LOCATION_CHECK_TIMEOUT_MS).then((next) => {
      if (active) setStatus(next);
    });
    return () => {
      active = false;
    };
  }, [evaluate]);

  // Re-check on focus/visibility. Covers BOTH directions: completing setup in
  // Settings and coming back lets the user in, and revoking there raises the
  // gate on an already-signed-in session.
  const sync = useCallback(async () => {
    setStatus(await evaluate());
  }, [evaluate]);

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
