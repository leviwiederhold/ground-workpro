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
export function isCapacitorNativePlatform(): boolean {
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
