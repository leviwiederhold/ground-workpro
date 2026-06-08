export function isNativeAppRuntime(): boolean {
  if (typeof window === "undefined") return false;

  const candidate = window as typeof window & {
    __GROUNDWORK_NATIVE_APP__?: boolean | string;
  };

  if (candidate.__GROUNDWORK_NATIVE_APP__ === true || candidate.__GROUNDWORK_NATIVE_APP__ === "1") {
    return true;
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get("gw_native") === "1" || params.get("groundworkNative") === "1") {
    try {
      window.localStorage.setItem("groundwork.nativeApp", "1");
    } catch {
      // Storage can be unavailable in locked-down WebViews.
    }
    return true;
  }

  try {
    return window.localStorage.getItem("groundwork.nativeApp") === "1";
  } catch {
    return false;
  }
}

export function isIosNativeAppRuntime(): boolean {
  if (typeof window === "undefined" || !isNativeAppRuntime()) return false;

  const candidate = window as typeof window & {
    __GROUNDWORK_NATIVE_PLATFORM__?: string;
    Capacitor?: {
      getPlatform?: () => string;
    };
  };

  if (String(candidate.__GROUNDWORK_NATIVE_PLATFORM__ ?? "").toLowerCase() === "ios") {
    return true;
  }

  if (typeof candidate.Capacitor?.getPlatform === "function") {
    try {
      return String(candidate.Capacitor.getPlatform() ?? "").toLowerCase() === "ios";
    } catch {
      // Fall through to the user-agent heuristic.
    }
  }

  return false;
}

/**
 * True only for a real mobile WEB browser (mobile Safari/Chrome) — NOT the
 * native Capacitor app and NOT desktop. Used to decide whether to show the
 * "download the iOS app" web prompt.
 */
export function isMobileWebBrowser(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  // Never inside the native app wrapper.
  if (isNativeAppRuntime()) return false;

  const ua = navigator.userAgent || "";
  // Phones/tablets. Includes iPadOS which reports as Macintosh + touch.
  const isMobileUa = /Android|iPhone|iPod|iPad|Mobile|Windows Phone/i.test(ua);
  const isIpadOs =
    /Macintosh/i.test(ua) && typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 1;

  return isMobileUa || isIpadOs;
}
