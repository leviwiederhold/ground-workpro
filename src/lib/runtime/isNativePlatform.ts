/**
 * Strict Capacitor native-container check.
 *
 * Unlike `isNativeAppRuntime()` (which also honors URL params and a localStorage
 * flag, so a plain web session can look "native"), this is true ONLY inside a
 * real Capacitor iOS/Android app — the same signal that decides whether the
 * native plugins (secure store, geofence) actually exist.
 *
 * The attendance gate's device-credential requirement MUST use this: a web
 * session that merely spoofs the broad native heuristic has no secure store to
 * hold a credential, so requiring one there would lock it out permanently.
 */
export type CapacitorNativePlatform = "ios" | "android";

export function getCapacitorNativePlatform(): CapacitorNativePlatform | null {
  if (typeof window === "undefined") return null;
  try {
    const capacitor = (window as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
    }).Capacitor;
    if (capacitor?.isNativePlatform?.() !== true) return null;
    const platform = String(capacitor.getPlatform?.() ?? "").toLowerCase();
    return platform === "ios" || platform === "android" ? platform : null;
  } catch {
    return null;
  }
}

export function isCapacitorNativePlatform(): boolean {
  return getCapacitorNativePlatform() !== null;
}
