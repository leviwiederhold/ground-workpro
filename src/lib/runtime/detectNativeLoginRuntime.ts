// Synchronous native-runtime detection for the login screen.
//
// WHY THIS EXISTS
//
// The login page previously derived "am I in the native app?" from a React
// effect that started as `false`. Combined with unreliable signals, that made
// the native provider buttons fail to appear on a fresh origin:
//
//   1. `__GROUNDWORK_NATIVE_APP__` — injected by AppDelegate via a WKUserScript
//      added AFTER the initial load has begun. User scripts only apply to
//      SUBSEQUENT navigations, and the evaluateJavaScript fallback targets the
//      pre-navigation document, so the flag is usually wiped by the page load.
//   2. `Capacitor.isNativePlatform()` — reliable only once the bridge has been
//      injected and evaluated.
//   3. `?gw_native=1` — only present if the WebView was told to load it.
//   4. `localStorage["groundwork.nativeApp"]` — ORIGIN-SCOPED. The production
//      origin had this set once by an old build and it persisted, which is why
//      production always worked. A Vercel preview is a different origin, so the
//      flag is absent there and this safety net silently disappears.
//
// So on production the app coasted on a persisted flag, masking that (1) and
// (3) were unreliable. On any new origin, only (2) remains — and if the bridge
// isn't ready when the effect runs, detection fails and the native buttons
// never render.
//
// This module checks every signal synchronously so the FIRST client render can
// already be correct, and persists a positive result so later navigations on
// the same origin stay native even if the live signals go quiet.

export type NativeRuntimeSignal =
  | "gw-native-param"
  | "capacitor-native"
  | "capacitor-ios"
  | "injected-marker"
  | "stored-flag"
  | "user-agent";

export const NATIVE_RUNTIME_STORAGE_KEY = "groundwork.nativeApp";

export type WindowLike = {
  location?: { search?: string; href?: string; host?: string };
  navigator?: { userAgent?: string };
  localStorage?: Pick<Storage, "getItem" | "setItem"> | null;
  Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
  __GROUNDWORK_NATIVE_APP__?: boolean | string;
  __GROUNDWORK_NATIVE_PLATFORM__?: string;
};

export type NativeRuntimeDetection = {
  isNative: boolean;
  /** The first trusted signal that matched, for diagnostics. */
  matched: NativeRuntimeSignal | null;
  signals: Record<NativeRuntimeSignal, boolean>;
  platform: string | null;
  bridgeAvailable: boolean;
};

function readParam(win: WindowLike, key: string): string | null {
  try {
    return new URLSearchParams(win.location?.search ?? "").get(key);
  } catch {
    return null;
  }
}

function safeCall<T>(fn: (() => T) | undefined): T | null {
  if (typeof fn !== "function") return null;
  try {
    return fn();
  } catch {
    return null;
  }
}

function readStoredFlag(win: WindowLike): boolean {
  try {
    return win.localStorage?.getItem(NATIVE_RUNTIME_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function persistFlag(win: WindowLike): void {
  try {
    win.localStorage?.setItem(NATIVE_RUNTIME_STORAGE_KEY, "1");
  } catch {
    // Storage can be unavailable in locked-down WebViews — non-fatal.
  }
}

/**
 * Inspect every native signal without short-circuiting, so diagnostics can show
 * which ones fired. Cheap: a few property reads and two function calls.
 */
export function readNativeRuntimeSignals(win: WindowLike | undefined): NativeRuntimeDetection {
  if (!win) {
    return {
      isNative: false,
      matched: null,
      platform: null,
      bridgeAvailable: false,
      signals: {
        "gw-native-param": false,
        "capacitor-native": false,
        "capacitor-ios": false,
        "injected-marker": false,
        "stored-flag": false,
        "user-agent": false,
      },
    };
  }

  const platform = safeCall(win.Capacitor?.getPlatform);
  const bridgeAvailable = typeof win.Capacitor?.isNativePlatform === "function";

  const gwNative = readParam(win, "gw_native") === "1" || readParam(win, "groundworkNative") === "1";
  const capacitorNative = safeCall(win.Capacitor?.isNativePlatform) === true;
  const capacitorIos = String(platform ?? "").toLowerCase() === "ios";
  const marker = win.__GROUNDWORK_NATIVE_APP__ === true || win.__GROUNDWORK_NATIVE_APP__ === "1";
  const markerPlatform = String(win.__GROUNDWORK_NATIVE_PLATFORM__ ?? "").toLowerCase() === "ios";
  // Capacitor does not add a UA marker by default; this covers a custom one if
  // the native shell ever sets applicationNameForUserAgent.
  const userAgent = /GroundworkNative/i.test(String(win.navigator?.userAgent ?? ""));
  const storedFlag = readStoredFlag(win);

  const signals: Record<NativeRuntimeSignal, boolean> = {
    "gw-native-param": gwNative,
    "capacitor-native": capacitorNative,
    "capacitor-ios": capacitorIos,
    "injected-marker": marker || markerPlatform,
    "stored-flag": storedFlag,
    "user-agent": userAgent,
  };

  // Ordered by trustworthiness. The param and the live bridge are authoritative;
  // the stored flag is last because it is a cache of a previous positive.
  const order: NativeRuntimeSignal[] = [
    "gw-native-param",
    "capacitor-native",
    "capacitor-ios",
    "injected-marker",
    "user-agent",
    "stored-flag",
  ];

  const matched = order.find((signal) => signals[signal]) ?? null;

  return { isNative: matched !== null, matched, platform: platform ?? null, bridgeAvailable, signals };
}

/**
 * True when any trusted native signal is present.
 *
 * Safe to call during render (including the lazy `useState` initializer) and on
 * the server, where it returns false. A positive result from a LIVE signal is
 * persisted so later navigations on the same origin remain native.
 */
export function detectNativeLoginRuntime(win: WindowLike | undefined = typeof window === "undefined" ? undefined : (window as WindowLike)): boolean {
  const detection = readNativeRuntimeSignals(win);

  // Don't re-persist when the only reason we're native is the stored flag.
  if (win && detection.isNative && detection.matched !== "stored-flag") {
    persistFlag(win);
  }

  return detection.isNative;
}
