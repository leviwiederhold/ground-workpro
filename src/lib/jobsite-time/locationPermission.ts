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
async function loadCapacitorGeolocation(): Promise<any | null> {
  const cap = getCapacitor();
  if (!cap?.isNativePlatform?.()) return null;
  try {
    const mod: any = await import("@capacitor/geolocation");
    return mod?.Geolocation ?? null;
  } catch {
    return null;
  }
}

// Non-prompting check of the current permission state (never shows a dialog).
export async function checkLocationPermission(): Promise<LocationPermissionState> {
  const geo = await loadCapacitorGeolocation();
  if (geo?.checkPermissions) {
    try {
      return mapCapacitorPermission(await geo.checkPermissions());
    } catch {
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

// Interactive request — MUST be called from a user gesture (button tap). Unlike
// the old helper (which only *queried* the Permissions API and never surfaced a
// dialog), this actually triggers the native iOS/Android OS prompt (via the
// Capacitor Geolocation plugin) or the browser prompt (via getCurrentPosition).
// Skips the prompt entirely when permission is already granted.
export async function requestLocationPermissionInteractive(): Promise<LocationPermissionResult> {
  const geo = await loadCapacitorGeolocation();
  if (geo) {
    try {
      // Read the current status FIRST. On iOS, requestPermissions() only surfaces
      // a dialog — and only resolves — when the status is undetermined ("prompt").
      // Calling it on an already-decided status (granted OR denied) is a no-op
      // whose authorization-change callback never fires, so the promise hangs
      // forever (this was the stuck "Requesting…" bug). Branch on the current
      // status instead of blindly requesting.
      let current: LocationPermissionState = "prompt";
      try {
        current = mapCapacitorPermission(await geo.checkPermissions());
      } catch {
        // checkPermissions unsupported/failed — assume undetermined and let the
        // request below try (a real prompt still resolves).
      }
      if (current === "granted") return "granted";
      if (current === "denied") return "denied";

      // current === "prompt" → safe to raise the OS dialog; it will resolve.
      const state = mapCapacitorPermission(await geo.requestPermissions());
      console.info("[attendance/location] native requestPermissions →", state);
      if (state === "granted") return "granted";
      if (state === "denied") return "denied";
      // Some platforms still report "prompt" after the dialog resolves — force a
      // single position read to confirm the outcome.
      try {
        const pos = await geo.getCurrentPosition({ enableHighAccuracy: false, timeout: 10000 });
        console.info("[attendance/location] native geolocation success", {
          lat: pos?.coords?.latitude,
          lng: pos?.coords?.longitude,
        });
        return "granted";
      } catch (err) {
        console.warn("[attendance/location] native geolocation error", err);
        return "denied";
      }
    } catch (err) {
      console.warn("[attendance/location] native permission request failed", err);
      return "unavailable";
    }
  }

  // Web / native WebView fallback.
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
