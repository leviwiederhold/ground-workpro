export function isNativeAppRuntime(): boolean {
  if (typeof window === "undefined") return false;

  const candidate = window as typeof window & {
    Capacitor?: {
      isNativePlatform?: () => boolean;
      getPlatform?: () => string;
    };
  };

  if (typeof candidate.Capacitor?.isNativePlatform === "function") {
    try {
      if (candidate.Capacitor.isNativePlatform()) return true;
    } catch {
      // Fall through to the other runtime signals.
    }
  }

  if (typeof candidate.Capacitor?.getPlatform === "function") {
    try {
      const platform = String(candidate.Capacitor.getPlatform() ?? "").toLowerCase();
      if (platform === "ios" || platform === "android") return true;
    } catch {
      // Fall through to the user-agent heuristic.
    }
  }

  const userAgent = String(window.navigator?.userAgent ?? "").toLowerCase();
  return userAgent.includes("capacitor") || userAgent.includes("cordova");
}

export function isIosNativeAppRuntime(): boolean {
  if (typeof window === "undefined" || !isNativeAppRuntime()) return false;

  const candidate = window as typeof window & {
    Capacitor?: {
      getPlatform?: () => string;
    };
  };

  if (typeof candidate.Capacitor?.getPlatform === "function") {
    try {
      return String(candidate.Capacitor.getPlatform() ?? "").toLowerCase() === "ios";
    } catch {
      // Fall through to the user-agent heuristic.
    }
  }

  const userAgent = String(window.navigator?.userAgent ?? "").toLowerCase();
  return userAgent.includes("iphone") || userAgent.includes("ipad") || userAgent.includes("ipod");
}
