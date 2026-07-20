"use client";

// Background-location onboarding for automatic attendance (native).
//
// Behavior contract:
//  - explains WHY background location is needed before requesting it;
//  - does NOT re-prompt once background access is granted (status "ready");
//  - detects revoked/downgraded access and asks again;
//  - shows a persistent "open Settings" status when the fix is OS-owned;
//  - never claims automatic attendance is active without background permission.

import { useCallback, useEffect, useState } from "react";
import {
  LOCATION_ONBOARDING_STATUS_MESSAGE,
  resolveOnboardingStatus,
  type LocationOnboardingStatus,
  type StoredLocationPermission,
} from "@/lib/attendance/backgroundLocation";
import {
  loadStoredLocationPermission,
  persistLocationPermission,
  readLocationPermissionSnapshot,
  requestBackgroundLocation,
} from "@/lib/attendance/backgroundLocationClient";

export function LocationOnboarding({ onComplete }: { onComplete?: () => void }) {
  const [status, setStatus] = useState<LocationOnboardingStatus | "checking">("checking");
  const [requesting, setRequesting] = useState(false);

  const refresh = useCallback(async () => {
    const current = await readLocationPermissionSnapshot();
    const stored: StoredLocationPermission | null = loadStoredLocationPermission();
    // Keep the server + local copy current so admins see live state and the app
    // can detect regressions on the next launch.
    await persistLocationPermission(current);
    const next = resolveOnboardingStatus(stored, current);
    setStatus(next);
    if (next === "ready") onComplete?.();
  }, [onComplete]);

  useEffect(() => {
    void refresh();
    // Re-check on resume: the user may have changed permissions in Settings.
    const onFocus = () => {
      if (typeof document === "undefined" || document.visibilityState !== "hidden") void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh]);

  const request = useCallback(async () => {
    setRequesting(true);
    try {
      const snapshot = await requestBackgroundLocation();
      await persistLocationPermission(snapshot, { onboardingCompleted: true });
      const next = resolveOnboardingStatus(loadStoredLocationPermission(), snapshot);
      setStatus(next);
      if (next === "ready") onComplete?.();
    } finally {
      setRequesting(false);
    }
  }, [onComplete]);

  if (status === "checking" || status === "ready") return null;

  const settingsBound = status === "settings_required" || status === "services_disabled";

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <i className="fa-solid fa-location-crosshairs mt-0.5 text-amber-600" />
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-amber-900">Enable automatic attendance</h3>
          <p className="mt-1 text-sm text-amber-800">
            Groundwork Pro clocks you in and out automatically when you arrive at and leave your assigned
            jobsite. That needs location set to <span className="font-medium">Always</span> with{" "}
            <span className="font-medium">Precise</span> on, so it can detect the jobsite even when the app is
            in the background.
          </p>
          <p className="mt-2 text-xs text-amber-700">{LOCATION_ONBOARDING_STATUS_MESSAGE[status]}</p>

          <div className="mt-3">
            {settingsBound ? (
              <p className="text-xs font-medium text-amber-900">
                Open the Settings app → Groundwork Pro → Location to finish. We can&apos;t change this from
                inside the app.
              </p>
            ) : (
              <button
                type="button"
                onClick={request}
                disabled={requesting}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {requesting ? "Requesting…" : "Enable location access"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
