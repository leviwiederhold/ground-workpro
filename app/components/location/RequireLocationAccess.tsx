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
// the full live native contract: Always + Precise authorization, healthy
// bridge, enrolled device credential, and assigned regions registered.
//
// The whole evaluation is time-bounded: a stalled check (the physical-iPhone
// white screen, where the Capacitor plugin import / bridge call can hang) can
// never leave the app rendering null forever — it falls back to the setup gate.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  checkLocationPermission,
  checkNativeLocationPermission,
  loadCapacitorGeolocation,
} from '@/lib/jobsite-time/locationPermission';
import {
  isAttendanceParticipant,
  isAttendanceSetupComplete,
  LOCATION_CHECK_TIMEOUT_MS,
  resolveGateStatusWithTimeout,
  retryTransientNativeRead,
  type GatePlatform,
  type LocationGateStatus,
} from '@/lib/jobsite-time/locationGate';
import { fetchAssignedJobsRequired } from '@/lib/jobsite-time/geofence-client';
import { isCapacitorNativePlatform } from '@/lib/runtime/isNativePlatform';
import {
  onGeofenceAuthorizationChanged,
  requireNativeGeofenceHealth,
  requireRegisteredGeofencesRead,
} from '@/lib/attendance/nativeGeofence';
import { loadAssignedAttendanceRegions } from '@/lib/attendance/assignedRegionsClient';
import { persistNativeAttendanceReadiness } from '@/lib/attendance/backgroundLocationClient';
import { hasActiveDeviceCredential } from '@/lib/attendance/deviceCredentialClient';
import { LocationRequiredGate } from './LocationRequiredGate';

export function RequireLocationAccess({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<LocationGateStatus>('checking');
  const evaluationVersion = useRef(0);

  // Non-prompting evaluation of the gate status:
  //   1. Participation — assigned to at least one job? A fetch failure blocks
  //      safely instead of incorrectly treating the user as unassigned.
  //   2. If a participant, is attendance setup complete? Web needs permission;
  //      native needs the complete live native contract described above.
  const evaluate = useCallback(async (version: number): Promise<LocationGateStatus> => {
    const jobs = await fetchAssignedJobsRequired();
    if (!isAttendanceParticipant({ assignedJobCount: jobs.length })) return 'granted';

    const platform: GatePlatform = isCapacitorNativePlatform() ? 'native' : 'web';
    let hasDeviceCredential = true;
    if (platform === 'native') {
      // Capacitor can expose the WebView before every native proxy is ready.
      // An unavailable proxy is indeterminate, not proof that setup regressed;
      // retry the strict bridge reads during that short cold-launch window.
      const permission = await retryTransientNativeRead(async () =>
        checkNativeLocationPermission(await loadCapacitorGeolocation()),
      );
      const [health, requiredRegions, registered] = await Promise.all([
        retryTransientNativeRead(requireNativeGeofenceHealth),
        loadAssignedAttendanceRegions(jobs),
        retryTransientNativeRead(requireRegisteredGeofencesRead),
      ]);
      hasDeviceCredential =
        Boolean(health?.hasCredential) &&
        await hasActiveDeviceCredential();
      const complete = isAttendanceSetupComplete({
        platform,
        permission,
        hasDeviceCredential,
        nativeHealth: health,
        requiredRegionIds: requiredRegions.map((region) => region.identifier),
        registeredRegionIds: registered.map((region) => region.identifier),
      });
      // This is a definitive live read. Synchronize the same answer used by the
      // CEO setup summary; transient bridge failures throw before reaching here
      // and therefore never flip a configured employee to false.
      if (version === evaluationVersion.current) {
        void persistNativeAttendanceReadiness(health, complete, {
          requiredRegionIds: requiredRegions.map((region) => region.identifier),
          registeredRegionIds: registered.map((region) => region.identifier),
        });
      }
      return complete ? 'granted' : 'blocked';
    }
    const permission = await checkLocationPermission();
    return isAttendanceSetupComplete({ platform, permission, hasDeviceCredential }) ? 'granted' : 'blocked';
  }, []);

  const sync = useCallback(async () => {
    const version = ++evaluationVersion.current;
    const next = await resolveGateStatusWithTimeout(
      () => evaluate(version),
      LOCATION_CHECK_TIMEOUT_MS,
    );
    // Focus + visibility can fire together. A slower earlier read must never
    // overwrite a later successful validation with a stale blocked result.
    if (version === evaluationVersion.current) setStatus(next);
  }, [evaluate]);

  useEffect(() => {
    void sync();
  }, [sync]);

  useEffect(() => {
    if (!isCapacitorNativePlatform()) return;
    let active = true;
    let unsubscribe = () => {};
    void onGeofenceAuthorizationChanged(({ authorized }) => {
      if (!active) return;
      if (!authorized) {
        evaluationVersion.current += 1;
        setStatus('blocked');
      } else {
        // Always restoration must revalidate the credential and actual region
        // set before the neutral gate can disappear.
        void sync();
      }
    }).then((remove) => {
      if (active) unsubscribe = remove;
      else remove();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [sync]);

  // Re-check on focus/visibility. Covers BOTH directions: completing setup in
  // Settings and coming back lets the user in, and revoking there raises the
  // gate on an already-signed-in session.
  useEffect(() => {
    const onFocus = () => void sync();
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') void sync();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [sync]);

  if (status === 'checking') return null;
  if (status !== 'granted') {
    return <LocationRequiredGate onGranted={() => setStatus('granted')} />;
  }
  return <>{children}</>;
}
