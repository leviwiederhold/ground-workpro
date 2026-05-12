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
