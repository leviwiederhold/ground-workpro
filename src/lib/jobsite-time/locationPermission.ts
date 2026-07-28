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

type CapacitorLike = { isNativePlatform?: () => boolean };

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

// Loads the native Capacitor Geolocation plugin, but ONLY inside the native app
// wrapper. On web this returns null so we use the standard browser prompt.
// Imported dynamically so the plugin never runs during SSR.
async function loadCapacitorGeolocation(): Promise<NativeGeolocationPlugin | null> {
  try {
    const mod: any = await import("@capacitor/geolocation");
    return (mod?.Geolocation as NativeGeolocationPlugin | undefined) ?? null;
  } catch {
    return null;
  }
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
      return mapCapacitorPermission(await geo.checkPermissions());
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
    const current = mapCapacitorPermission(await geo.checkPermissions());
    console.info("[location/setup] native checkPermissions →", current);
    if (current === "granted") return "granted";
    if (current === "denied") return "denied";

    const state = mapCapacitorPermission(await geo.requestPermissions());
    console.info("[location/setup] native requestPermissions →", state);
    if (state === "granted") return "granted";
    if (state === "denied") return "denied";

    // A platform that still reports prompt gets one bounded position read to
    // establish the terminal state.
    try {
      const pos = await geo.getCurrentPosition({ enableHighAccuracy: false, timeout: 10000 });
      console.info("[location/setup] native getCurrentPosition → granted", {
        lat: pos?.coords?.latitude,
        lng: pos?.coords?.longitude,
      });
      return "granted";
    } catch (error) {
      console.warn("[location/setup] native getCurrentPosition failed", error);
      return "unavailable";
    }
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
