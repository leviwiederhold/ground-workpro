/* eslint-disable @typescript-eslint/no-explicit-any */

// Attendance location permission (clock-in/out only). Self-contained — no
// relative imports — so the four required outcomes can be unit-tested directly.
//
// The key fix vs the old helper: tapping "Allow" now actually TRIGGERS the OS
// dialog (native Capacitor Geolocation request, or the browser getCurrentPosition
// prompt) from the user's gesture, instead of only *querying* the Permissions
// API (which never surfaces a dialog — the old cause of "nothing happens").

export type LocationPermissionResult = "granted" | "denied" | "unavailable";
export type LocationPermissionState = LocationPermissionResult | "prompt";

type CapacitorLike = {
  isNativePlatform?: () => boolean;
  Plugins?: { Geolocation?: NativeGeolocationPlugin };
};

export interface NativeGeolocationPlugin {
  checkPermissions(): Promise<{ location?: string; coarseLocation?: string }>;
  requestPermissions(): Promise<{ location?: string; coarseLocation?: string }>;
  getCurrentPosition(options: {
    enableHighAccuracy: boolean;
    timeout: number;
  }): Promise<{ coords?: { latitude?: number; longitude?: number } }>;
}

function getCapacitor(): CapacitorLike | null {
  if (typeof window === "undefined") return null;
  return (window as any).Capacitor ?? null;
}

// Map a Capacitor Geolocation PermissionStatus to our coarse state. Pure.
// Considers BOTH the fine (`location`) and coarse (`coarseLocation`) grants:
// on Android 12+ a user can grant Approximate location only, so coarse can be
// granted while fine is not. Every position request here uses
// enableHighAccuracy:false, so a coarse grant is sufficient — treat either
// grant as granted, and prefer prompting over blocking when possible.
export function mapCapacitorPermission(
  status: { location?: string; coarseLocation?: string } | null | undefined
): LocationPermissionState {
  const states = [
    String(status?.location ?? "").toLowerCase(),
    String(status?.coarseLocation ?? "").toLowerCase(),
  ];
  if (states.includes("granted")) return "granted";
  // Either alias still able to prompt → we can still surface the OS dialog.
  if (states.some((s) => s === "prompt" || s === "prompt-with-rationale")) return "prompt";
  if (states.includes("denied")) return "denied";
  // Unknown/empty → needs the OS dialog.
  return "prompt";
}

// Map a browser GeolocationPositionError to our coarse result. Pure.
// code 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT.
export function mapGeolocationError(err: { code?: number } | null | undefined): LocationPermissionResult {
  return err?.code === 1 ? "denied" : "unavailable";
}

// Use the proxy injected by the native iOS bridge at document start. Two
// physical-device traces reached "checking_location_permission" but never
// emitted Capacitor's "To Native -> Geolocation checkPermissions" line when
// using the npm module proxy (first dynamically, then statically). Calling the
// bridge-owned proxy removes that competing JS registration boundary. If the
// binary did not register Geolocation, return null and let the named stage fail
// visibly instead of falling through to WKWebView geolocation.
export async function loadCapacitorGeolocation(): Promise<NativeGeolocationPlugin | null> {
  const plugin = getCapacitor()?.Plugins?.Geolocation ?? null;
  console.info(
    "[location/setup] native Geolocation bridge proxy",
    plugin ? "available" : "unavailable",
  );
  return plugin;
}

/** Strict native check used by the diagnostic setup pipeline. */
export async function checkNativeLocationPermission(
  geo: NativeGeolocationPlugin | null,
): Promise<LocationPermissionState> {
  if (!geo) throw new Error("Capacitor Geolocation native bridge unavailable");
  return mapCapacitorPermission(await geo.checkPermissions());
}

/**
 * Request from an already-confirmed prompt state. This deliberately performs no
 * check of its own: the gate times and reports the check and request as separate
 * native transitions.
 */
export async function requestNativeLocationPermissionFromPrompt(
  geo: NativeGeolocationPlugin | null,
): Promise<LocationPermissionResult> {
  if (!geo) throw new Error("Capacitor Geolocation native bridge unavailable");
  const state = mapCapacitorPermission(await geo.requestPermissions());
  console.info("[location/setup] native requestPermissions →", state);
  if (state === "granted") return "granted";
  if (state === "denied") return "denied";

  const position = await geo.getCurrentPosition({ enableHighAccuracy: false, timeout: 10_000 });
  console.info("[location/setup] native getCurrentPosition → granted", {
    lat: position?.coords?.latitude,
    lng: position?.coords?.longitude,
  });
  return "granted";
}

// Non-prompting check of the current permission state (never shows a dialog).
export async function checkLocationPermission(): Promise<LocationPermissionState> {
  const native = getCapacitor()?.isNativePlatform?.() === true;
  if (native) {
    const geo = await loadCapacitorGeolocation();
    if (!geo) {
      console.warn("[location/setup] native Geolocation bridge unavailable during permission check");
      return "unavailable";
    }
    try {
      return await checkNativeLocationPermission(geo);
    } catch (error) {
      console.warn("[location/setup] native checkPermissions failed", error);
      return "unavailable";
    }
  }
  if (typeof navigator !== "undefined" && (navigator as any).permissions?.query) {
    try {
      const status = await (navigator as any).permissions.query({ name: "geolocation" as PermissionName });
      if (status.state === "granted" || status.state === "denied" || status.state === "prompt") {
        return status.state;
      }
    } catch {
      // Permissions API unavailable — fall through.
    }
  }
  if (typeof navigator !== "undefined" && navigator.geolocation) return "prompt";
  return "unavailable";
}

/**
 * The real native permission transition, dependency-injected so the Capacitor
 * bridge behavior is covered without pretending the browser fallback is iOS.
 */
export async function requestNativeLocationPermission(
  geo: NativeGeolocationPlugin | null,
): Promise<LocationPermissionResult> {
  if (!geo) {
    console.warn("[location/setup] native Geolocation bridge unavailable");
    return "unavailable";
  }

  try {
    // Read the current status first. Besides avoiding an unnecessary system
    // call, this is what turns an existing denial into Settings instructions
    // instead of waiting for a prompt that iOS will never show again.
    const current = await checkNativeLocationPermission(geo);
    console.info("[location/setup] native checkPermissions →", current);
    if (current === "granted") return "granted";
    if (current === "denied") return "denied";

    return await requestNativeLocationPermissionFromPrompt(geo);
  } catch (error) {
    console.warn("[location/setup] native permission bridge call failed", error);
    return "unavailable";
  }
}

// Interactive request — MUST be called from a user gesture (button tap).
export async function requestLocationPermissionInteractive(): Promise<LocationPermissionResult> {
  const native = getCapacitor()?.isNativePlatform?.() === true;
  if (native) {
    // A native shell must use the native bridge. Falling through to WKWebView's
    // browser geolocation when the plugin is missing hides a broken binary and
    // can leave the user waiting for a prompt owned by the wrong runtime.
    return requestNativeLocationPermission(await loadCapacitorGeolocation());
  }

  // Web only.
  if (typeof navigator === "undefined" || !navigator.geolocation?.getCurrentPosition) {
    return "unavailable";
  }
  // Skip the prompt if the Permissions API already has a definitive answer.
  try {
    const status = await (navigator as any).permissions?.query?.({ name: "geolocation" as PermissionName });
    if (status?.state === "granted") return "granted";
    if (status?.state === "denied") return "denied";
  } catch {
    // No Permissions API — just prompt via getCurrentPosition below.
  }
  return await new Promise<LocationPermissionResult>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        console.info("[attendance/location] geolocation success", {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        resolve("granted");
      },
      (err) => {
        console.warn("[attendance/location] geolocation error", { code: err?.code, message: err?.message });
        resolve(mapGeolocationError(err));
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 }
    );
  });
}

// Presentation resolver for the attendance location gate. Pure, so the four
// required states are unit-tested without a DOM:
//   granted     → show the clock-in flow (children)
//   prompt      → show the iOS-style pre-permission card
//   denied      → show blocked-with-settings instructions
//   unavailable → show the specific "location unavailable" error
export type LocationGateView = "checking" | "clock-in" | "pre-permission" | "blocked" | "unavailable";
export function resolveLocationGateView(state: LocationPermissionState | "checking"): LocationGateView {
  if (state === "checking") return "checking";
  if (state === "granted") return "clock-in";
  if (state === "denied") return "blocked";
  if (state === "unavailable") return "unavailable";
  return "pre-permission"; // "prompt"
}
