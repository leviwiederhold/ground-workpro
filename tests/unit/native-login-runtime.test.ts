import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  detectNativeLoginRuntime,
  readNativeRuntimeSignals,
  NATIVE_RUNTIME_STORAGE_KEY,
  type WindowLike,
} from "../../src/lib/runtime/detectNativeLoginRuntime.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

// Minimal fake window. Storage defaults to a working in-memory implementation
// so the "persist a positive result" behaviour is observable.
function makeWindow(overrides: Partial<WindowLike> & { search?: string } = {}): WindowLike {
  const store = new Map<string, string>();
  const { search, ...rest } = overrides;
  return {
    location: { search: search ?? "", href: "https://example.vercel.app/login", host: "example.vercel.app" },
    navigator: { userAgent: "Mozilla/5.0" },
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
    ...rest,
  };
}

// ── Individual signals ───────────────────────────────────────────────────────
test("gw_native=1 alone returns native true", () => {
  assert.equal(detectNativeLoginRuntime(makeWindow({ search: "?gw_native=1" })), true);
  // Legacy spelling kept working.
  assert.equal(detectNativeLoginRuntime(makeWindow({ search: "?groundworkNative=1" })), true);
  // Combined with other params.
  assert.equal(detectNativeLoginRuntime(makeWindow({ search: "?invite=1&gw_native=1" })), true);
});

test("Capacitor.isNativePlatform() true returns native true", () => {
  const win = makeWindow({ Capacitor: { isNativePlatform: () => true } });
  assert.equal(detectNativeLoginRuntime(win), true);
});

test("Capacitor.getPlatform() === 'ios' returns native true", () => {
  // Bridge present but isNativePlatform absent/false — platform still decides.
  const win = makeWindow({ Capacitor: { getPlatform: () => "ios" } });
  assert.equal(detectNativeLoginRuntime(win), true);

  const mixedCase = makeWindow({ Capacitor: { isNativePlatform: () => false, getPlatform: () => "iOS" } });
  assert.equal(detectNativeLoginRuntime(mixedCase), true);
});

test("the injected AppDelegate marker returns native true", () => {
  assert.equal(detectNativeLoginRuntime(makeWindow({ __GROUNDWORK_NATIVE_APP__: true })), true);
  assert.equal(detectNativeLoginRuntime(makeWindow({ __GROUNDWORK_NATIVE_APP__: "1" })), true);
  assert.equal(detectNativeLoginRuntime(makeWindow({ __GROUNDWORK_NATIVE_PLATFORM__: "ios" })), true);
});

test("a plain web browser with no marker returns false", () => {
  assert.equal(detectNativeLoginRuntime(makeWindow()), false);

  // A web page that merely has Capacitor defined but reporting web.
  const webCapacitor = makeWindow({
    Capacitor: { isNativePlatform: () => false, getPlatform: () => "web" },
  });
  assert.equal(detectNativeLoginRuntime(webCapacitor), false);

  // Server-side rendering.
  assert.equal(detectNativeLoginRuntime(undefined), false);
});

// ── Robustness ───────────────────────────────────────────────────────────────
test("a throwing Capacitor bridge does not break detection", () => {
  const throwing = makeWindow({
    search: "?gw_native=1",
    Capacitor: {
      isNativePlatform: () => {
        throw new Error("bridge not ready");
      },
      getPlatform: () => {
        throw new Error("bridge not ready");
      },
    },
  });
  // The param must still win even though the bridge blows up.
  assert.equal(detectNativeLoginRuntime(throwing), true);
});

test("unavailable localStorage does not break detection", () => {
  const noStorage = makeWindow({
    search: "?gw_native=1",
    localStorage: {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    },
  });
  assert.equal(detectNativeLoginRuntime(noStorage), true);
});

test("a live signal is persisted so later navigations stay native", () => {
  const win = makeWindow({ search: "?gw_native=1" });
  assert.equal(detectNativeLoginRuntime(win), true);
  assert.equal(win.localStorage?.getItem(NATIVE_RUNTIME_STORAGE_KEY), "1");

  // Same origin, param gone, bridge quiet — still native via the stored flag.
  const later: WindowLike = { ...win, location: { search: "" } };
  const detection = readNativeRuntimeSignals(later);
  assert.equal(detection.isNative, true);
  assert.equal(detection.matched, "stored-flag");
});

test("detection reports which signal matched, for diagnostics", () => {
  const param = readNativeRuntimeSignals(makeWindow({ search: "?gw_native=1" }));
  assert.equal(param.matched, "gw-native-param");

  const bridge = readNativeRuntimeSignals(makeWindow({ Capacitor: { isNativePlatform: () => true } }));
  assert.equal(bridge.matched, "capacitor-native");
  assert.equal(bridge.bridgeAvailable, true);

  const web = readNativeRuntimeSignals(makeWindow());
  assert.equal(web.matched, null);
  assert.equal(web.isNative, false);
});

// ── The detector's remaining job ─────────────────────────────────────────────
// Since the dedicated /native/login route now decides whether the native UI
// EXISTS, this detector is only used for plugin availability and diagnostics.
// These tests pin that narrowed contract.

test("the detector is no longer used to gate whether native UI renders", () => {
  const nativePage = read("app/native/login/page.tsx");

  // It may guard plugin calls...
  assert.match(nativePage, /if \(!detectNativeLoginRuntime\(\)\)/, "plugin calls must still be guarded");

  // ...but the buttons themselves must not be behind it.
  const buttonsStart = nativePage.indexOf('data-testid="native-provider-buttons"');
  const buttonsEnd = nativePage.indexOf("Continue with Email");
  const block = nativePage.slice(buttonsStart, buttonsEnd);
  assert.ok(
    !block.includes("detectNativeLoginRuntime"),
    "provider buttons must render from the route alone, not from runtime detection",
  );
});

test("the web login route does not use the native detector at all", () => {
  const webPage = read("app/login/page.tsx");
  assert.ok(
    !webPage.includes("detectNativeLoginRuntime"),
    "the web route must not depend on native detection",
  );
});

test("AppDelegate targets the native route, keeping the marker only as a fallback", () => {
  const appDelegate = read("ios/App/App/AppDelegate.swift");

  // Explicit /native/* routes are the primary distinction; the app enters at
  // the onboarding route.
  assert.match(appDelegate, /nativeEntryPath = "\/native"/);
  assert.match(appDelegate, /components\.path = nativeEntryPath/);

  // The marker survives only as a diagnostic fallback signal.
  assert.match(appDelegate, /gw_native/, "the marker may remain as a fallback signal");
  assert.match(
    appDelegate,
    /FALLBACK diagnostic signal/i,
    "the marker's reduced role should be documented at the call site",
  );
});
