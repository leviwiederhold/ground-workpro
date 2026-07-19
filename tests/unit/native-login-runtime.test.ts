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

// ── Login page wiring ────────────────────────────────────────────────────────
// The detector is only useful if the page actually consumes it correctly.
test("login page initializes nativeRuntime synchronously, not from a false effect", () => {
  const page = read("app/login/page.tsx");

  assert.match(
    page,
    /useState<boolean>\(\(\) => detectNativeLoginRuntime\(\)\)/,
    "nativeRuntime must use a lazy initializer so the first client render is correct",
  );
  assert.doesNotMatch(
    page,
    /const \[nativeRuntime, setNativeRuntime\] = useState\(false\)/,
    "nativeRuntime must not start as an unconditional false",
  );
  assert.match(
    page,
    /if \(isNative\) setNativeRuntime\(true\)/,
    "the post-hydration recheck must never downgrade a positive detection",
  );
});

test("native provider buttons render whenever nativeRuntime is true", () => {
  const page = read("app/login/page.tsx");

  // Order: Apple, then Google, then Email.
  const apple = page.indexOf("Continue with Apple");
  const google = page.indexOf("Continue with Google");
  const email = page.indexOf("Continue with Email");
  assert.ok(apple > 0 && google > apple && email > google, "expected Apple, then Google, then Email");

  // The email/password form must stay hidden until Continue with Email is tapped.
  assert.match(
    page,
    /\(!nativeRuntime \|\| showEmailForm\) &&/,
    "the email form must be gated on showEmailForm in native mode",
  );
  assert.match(page, /onClick=\{\(\) => setShowEmailForm\(true\)\}/, "Continue with Email must reveal the form");
});

test("missing Google configuration does not hide the Google button", () => {
  const page = read("app/login/page.tsx");

  // The Google button's rendering must not depend on any config/env check —
  // configuration is validated only after the tap, inside the sign-in handler.
  const buttonBlock = page.slice(page.indexOf("Continue with Apple") - 1200, page.indexOf("Continue with Email"));
  assert.doesNotMatch(
    buttonBlock,
    /NEXT_PUBLIC_GOOGLE|readGoogleClientConfig|validateGoogleClientConfig/,
    "provider buttons must render regardless of configuration",
  );

  // The check lives in the tap handler instead.
  const nativeOAuth = read("src/lib/auth/nativeOAuth.ts");
  assert.match(
    nativeOAuth,
    /signInWithGoogleNative[\s\S]{0,400}readGoogleClientConfig\(\)/,
    "configuration must be validated inside the sign-in handler, after the tap",
  );
});

// ── Diagnostics are preview-only ─────────────────────────────────────────────
test("diagnostics never render on the production host", () => {
  const badge = read("app/components/debug/NativeAuthDebugBadge.tsx");
  assert.match(badge, /ground-workpro\.vercel\.app/, "the production host must be excluded explicitly");
  assert.match(badge, /if \(!isDiagnosticsHost\(\)\) return/, "diagnostics must bail out on production");
});

// ── The native shell must supply a deterministic signal ──────────────────────
test("AppDelegate guarantees the gw_native marker reaches the page", () => {
  const appDelegate = read("ios/App/App/AppDelegate.swift");

  assert.match(appDelegate, /gw_native/, "the native shell must append the marker");
  assert.match(
    appDelegate,
    /alreadyMarked/,
    "the shell must only skip the explicit load when the page already carries the marker",
  );
  // The host-only short-circuit is what dropped the marker on a fresh origin.
  assert.doesNotMatch(
    appDelegate,
    /if webView\.url\?\.host == appURL\.host \{\s*\n\s*didLoadAppURL = true/,
    "matching on host alone must not short-circuit the marked load",
  );
});
