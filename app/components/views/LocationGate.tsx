'use client';

import { useCallback, useEffect, useState } from 'react';

const MANAGER_ROLES = new Set(['executive', 'operations', 'pm', 'admin', 'manager', 'ceo']);
const FIELD_TRACKING_ROLES = new Set(['foreman', 'field', 'fieldstaff', 'operator', 'laborer', 'labourer', 'mechanic']);

type PermState = 'unknown' | 'granted' | 'denied' | 'prompt' | 'unavailable';
type UserState = 'Waiting for permission' | 'Location access allowed' | 'Location blocked';

const REQUIRED_LOCATION_ERROR =
  'Location access is required to use attendance tracking. Please allow location access in your browser settings.';

function needsAttendanceTracking(role?: string | null) {
  const normalized = String(role || '').trim().toLowerCase();
  if (!normalized || MANAGER_ROLES.has(normalized)) return false;
  return FIELD_TRACKING_ROLES.has(normalized);
}

export function LocationGate({ role }: { role?: string | null }) {
  const [perm, setPerm] = useState<PermState>('unknown');
  const [checking, setChecking] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState('');

  const shouldGate = needsAttendanceTracking(role);

  const check = useCallback(async () => {
    if (!shouldGate) {
      setChecking(false);
      return;
    }
    setChecking(true);
    try {
      if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
        const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
        setPerm((status.state as PermState) ?? 'prompt');
        status.onchange = () => {
          setPerm((status.state as PermState) ?? 'prompt');
          if (status.state === 'granted') setError('');
        };
      } else if (typeof navigator !== 'undefined' && navigator.geolocation) {
        setPerm('prompt');
      } else {
        setPerm('unavailable');
        setError('Location services are not available in this browser or device.');
      }
    } catch {
      setPerm(typeof navigator !== 'undefined' && navigator.geolocation ? 'prompt' : 'unavailable');
    } finally {
      setChecking(false);
    }
  }, [shouldGate]);

  useEffect(() => { check(); }, [check]);

  const enable = async () => {
    setRequesting(true);
    setError('');
    try {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        setPerm('unavailable');
        setError('Location services are not available in this browser or device.');
        return;
      }

      await new Promise<void>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          () => {
            setPerm('granted');
            setError('');
            resolve();
          },
          (positionError) => {
            setPerm(positionError.code === positionError.PERMISSION_DENIED ? 'denied' : 'prompt');
            setError(
              positionError.code === positionError.PERMISSION_DENIED
                ? REQUIRED_LOCATION_ERROR
                : 'We could not confirm your location permission. Please check your browser settings and try again.'
            );
            resolve();
          },
          { enableHighAccuracy: false, maximumAge: 0, timeout: 10000 }
        );
      });
    } catch {
      setPerm('prompt');
      setError('We could not confirm your location permission. Please check your browser settings and try again.');
    } finally {
      setRequesting(false);
    }
  };

  const userState: UserState =
    perm === 'granted'
      ? 'Location access allowed'
      : perm === 'denied'
        ? 'Location blocked'
        : 'Waiting for permission';

  if (!shouldGate || checking || perm === 'granted') return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" data-testid="location-gate" role="dialog" aria-modal="true" aria-labelledby="location-gate-title">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-[#090909]">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
          <i className="fa-solid fa-location-dot text-xl" aria-hidden="true" />
        </div>
        <h1 id="location-gate-title" className="text-xl font-semibold text-gray-900 dark:text-zinc-100">
          Allow location access
        </h1>
        <p className="mt-3 text-sm leading-6 text-gray-600 dark:text-zinc-300">
          Groundwork Pro uses your location during assigned shifts to verify jobsite arrival and departure. We do not track your location outside work or store your travel path.
        </p>

        <div className="mt-5 rounded-xl bg-gray-50 p-3 text-sm text-gray-700 dark:bg-[#050505] dark:text-zinc-300">
          {userState}
        </div>

        {error ? (
          <p className="mt-4 text-sm leading-6 text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={enable}
          disabled={requesting}
          className="mt-6 w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          data-testid="location-gate-enable"
        >
          {requesting ? 'Waiting for permission' : 'Allow location'}
        </button>

        <p className="mt-4 text-xs leading-5 text-gray-500 dark:text-zinc-500">
          If you previously blocked location access, update your browser or device settings to allow location for Groundwork Pro.
        </p>
      </div>
    </div>
  );
}
