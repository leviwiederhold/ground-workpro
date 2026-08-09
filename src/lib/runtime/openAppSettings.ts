// Opens the OS/browser location settings for Groundwork Pro.
//
// IMPORTANT ASYMMETRY: this can only actually navigate on native.
//
//   iOS/Android — `app-settings:` is handed to the OS via Capacitor's `_system`
//                 target, which opens this app's settings page directly.
//   Web         — browsers deliberately provide NO API to open site settings;
//                 it is a deliberate anti-abuse restriction. The caller must
//                 fall back to showing instructions.
//
// The return value tells the caller which happened, so the UI can show
// instructions instead of a button that does nothing.

export type OpenSettingsOutcome = "opened" | "unsupported";

function isNativeRuntime(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.() ===
      true
    );
  } catch {
    return false;
  }
}

export function openAppLocationSettings(): OpenSettingsOutcome {
  if (typeof window === "undefined") return "unsupported";
  if (!isNativeRuntime()) return "unsupported";

  try {
    // "_system" hands the URL to the OS rather than the in-app WebView.
    window.open("app-settings:", "_system");
    return "opened";
  } catch {
    return "unsupported";
  }
}

/** Platform-appropriate instructions for re-enabling location by hand. */
export function locationSettingsInstructions(platform: boolean | "ios" | "android" | "web"): string {
  if (platform === "android") {
    return "Open App settings → Permissions → Location → Allow all the time, and turn on precise location. If Android lists Battery usage, allow background activity.";
  }
  if (platform === true || platform === "ios") {
    return "Location access needs one more step. Open Settings and set Location to Always. Make sure Precise Location is on.";
  }
  return "Open your browser’s site settings for this page (the icon in the address bar) → Location → Allow, then reload.";
}
