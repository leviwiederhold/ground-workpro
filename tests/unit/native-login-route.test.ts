import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  NATIVE_LOGIN_ROUTE,
  WEB_LOGIN_ROUTE,
  resolveSignOutRoute,
  getPendingInvite,
} from "../../src/lib/auth/loginFlow.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const nativePage = () => read("app/native/login/page.tsx");
const webPage = () => read("app/login/page.tsx");

// ── Routes are the authoritative split ───────────────────────────────────────
test("the two login entry points are distinct and stable", () => {
  assert.equal(NATIVE_LOGIN_ROUTE, "/native/login");
  assert.equal(WEB_LOGIN_ROUTE, "/login");
  assert.ok(existsSync(join(repoRoot, "app/native/login/page.tsx")), "the native route must exist");
  assert.ok(existsSync(join(repoRoot, "app/login/page.tsx")), "the web route must still exist");
});

// ── /native/login renders the native UI unconditionally ──────────────────────
test("/native/login renders Apple, Google, and Email buttons in order", () => {
  const page = nativePage();

  const apple = page.indexOf("Continue with Apple");
  const google = page.indexOf("Continue with Google");
  const email = page.indexOf("Continue with Email");

  assert.ok(apple > 0, "Apple button must exist");
  assert.ok(google > apple, "Google must come after Apple");
  assert.ok(email > google, "Email must come after Google");
});

test("native provider buttons are NOT gated behind runtime detection", () => {
  const page = nativePage();

  // The buttons live in a plainly-rendered container, not a conditional branch.
  assert.match(page, /data-testid="native-provider-buttons"/);

  const buttonsStart = page.indexOf('data-testid="native-provider-buttons"');
  const buttonsEnd = page.indexOf("Continue with Email");
  const block = page.slice(buttonsStart, buttonsEnd);

  for (const forbidden of ["nativeRuntime", "localStorage", "detectNativeLoginRuntime", "useEffect"]) {
    assert.ok(
      !block.includes(forbidden),
      `provider buttons must not be gated on ${forbidden} — the route is the distinction`,
    );
  }
});

test("/native/login hides email fields until Continue with Email is tapped", () => {
  const page = nativePage();

  assert.match(page, /showEmailForm \? \(/, "the email form must be conditional on showEmailForm");
  assert.match(page, /useState\(false\)/, "showEmailForm must start hidden");
  assert.match(page, /onClick=\{\(\) => setShowEmailForm\(true\)\}/, "Continue with Email must reveal the form");

  // The inputs must live INSIDE the conditional block, not above it.
  const formIndex = page.indexOf('data-testid="native-email-form"');
  const emailInput = page.indexOf('id="native-email"');
  assert.ok(formIndex > 0 && emailInput > formIndex, "email input must be inside the gated form");
});

// ── Session, routing, invites ────────────────────────────────────────────────
test("successful native login routes to the dashboard", () => {
  const page = nativePage();
  assert.match(page, /routeAfterAuth/, "there must be a post-auth routing step");
  assert.match(page, /router\.replace\("\/"\)/, "success must land on the dashboard");
  assert.match(page, /resolveNativePostAuthDestination/, "routing must use the shared destination resolver");
});

test("an existing session on /native/login redirects instead of trapping the user", () => {
  const page = nativePage();
  assert.match(
    page,
    /getSession\(\)[\s\S]{0,400}routeAfterAuth\(\)/,
    "an existing session must route onward, not leave the user on the login page",
  );
});

test("pending invite state survives the native provider sheet", () => {
  const page = nativePage();
  assert.match(page, /writePendingInviteState\(readPendingInviteFromSearch/, "invite state must be persisted pre-sheet");

  // And the shared resolver accepts the invite before deciding the destination.
  const flow = read("src/lib/auth/loginFlow.ts");
  assert.match(
    flow,
    /if \(pendingInvite\)[\s\S]{0,300}ensureTenantContext/,
    "an invited user must go through invite acceptance",
  );
  assert.doesNotMatch(
    flow.slice(flow.indexOf("resolveNativePostAuthDestination")),
    /bootstrap/,
    "an invited user must never hit company bootstrap (would create a duplicate workspace)",
  );
});

test("getPendingInvite prefers the URL and falls back to stored state", () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  } as unknown as Storage;

  assert.equal(getPendingInvite("", storage), null);

  const fromUrl = getPendingInvite("?invite=1&token=abc&companyName=Acme", storage);
  assert.equal(fromUrl?.invite, "1");
  assert.equal(fromUrl?.token, "abc");

  store.set("groundwork:native-pending-invite", JSON.stringify({ invite: "1", token: "stored" }));
  assert.equal(getPendingInvite("", storage)?.token, "stored");
  // URL still wins when present.
  assert.equal(getPendingInvite("?invite=1&token=fresh", storage)?.token, "fresh");
});

// ── Sign-out ─────────────────────────────────────────────────────────────────
test("native sign-out returns to /native/login and web sign-out to /login", () => {
  assert.equal(resolveSignOutRoute("/native/login"), NATIVE_LOGIN_ROUTE);
  assert.equal(resolveSignOutRoute("/native/anything"), NATIVE_LOGIN_ROUTE);

  assert.equal(resolveSignOutRoute("/"), WEB_LOGIN_ROUTE);
  assert.equal(resolveSignOutRoute("/login"), WEB_LOGIN_ROUTE);
  assert.equal(resolveSignOutRoute("/settings/account"), WEB_LOGIN_ROUTE);
  assert.equal(resolveSignOutRoute(null), WEB_LOGIN_ROUTE);
  assert.equal(resolveSignOutRoute(undefined), WEB_LOGIN_ROUTE);

  // A path that merely CONTAINS "native" must not count.
  assert.equal(resolveSignOutRoute("/alternative/login"), WEB_LOGIN_ROUTE);

  // The dashboard must actually use the resolver.
  assert.match(read("app/page.tsx"), /window\.location\.assign\(resolveSignOutRoute\(window\.location\.pathname\)\)/);
});

// ── Web route is untouched ───────────────────────────────────────────────────
test("/login keeps web behaviour and carries no native-only UI", () => {
  const page = webPage();

  assert.match(page, /OAuthButtons/, "the web route must keep its web OAuth buttons");

  for (const nativeOnly of [
    "signInWithAppleNative",
    "signInWithGoogleNative",
    "NativeLoginDiagnostics",
    "NativeAuthDebugBadge",
    "detectNativeLoginRuntime",
  ]) {
    assert.ok(!page.includes(nativeOnly), `/login must not contain native-only symbol ${nativeOnly}`);
  }
});

test("diagnostics render only on the native route and never on production", () => {
  const diagnostics = read("app/components/debug/NativeLoginDiagnostics.tsx");
  assert.match(diagnostics, /ground-workpro\.vercel\.app/, "production host must be excluded");
  assert.match(diagnostics, /if \(!isDiagnosticsHost\(window\.location\.host\)\) return/);

  // Only the native page mounts it.
  assert.match(nativePage(), /<NativeLoginDiagnostics \/>/);
  assert.ok(!webPage().includes("NativeLoginDiagnostics"), "the web route must not mount diagnostics");
});

// ── Middleware ───────────────────────────────────────────────────────────────
test("/native/login is public in middleware and never redirects to /login", () => {
  const middleware = read("middleware.ts");

  assert.match(
    middleware,
    /PAGE_GUARD_BYPASSES = new Set\(\[[^\]]*"\/native\/login"/,
    "/native/login must be an explicit page-guard bypass",
  );

  // It must not appear in the guarded route table.
  const guards = read("src/lib/nav/config.ts");
  assert.ok(!guards.includes("/native"), "/native must not be a guarded prefix");
});

// ── Browser fallback ─────────────────────────────────────────────────────────
test("browser access to /native/login is handled without invoking native plugins", () => {
  const page = nativePage();

  // A visitor in a normal browser gets an escape hatch to the web route.
  assert.match(page, /BrowserFallbackNotice/);
  assert.match(page, /WEB_LOGIN_ROUTE/, "the fallback must link to the web login route");

  // Tapping a provider in a browser must bail BEFORE touching the plugin.
  assert.match(
    page,
    /if \(!detectNativeLoginRuntime\(\)\)[\s\S]{0,300}return;/,
    "provider handlers must refuse to run outside the native runtime",
  );
  const handlerStart = page.indexOf("async function onProviderSignIn");
  const guardIndex = page.indexOf("!detectNativeLoginRuntime()", handlerStart);
  const pluginIndex = page.indexOf("signInWithAppleNative", handlerStart);
  assert.ok(guardIndex > 0 && guardIndex < pluginIndex, "the guard must precede any plugin call");
});

// ── Native shell points at the route ─────────────────────────────────────────
test("AppDelegate opens the dedicated native login route", () => {
  const appDelegate = read("ios/App/App/AppDelegate.swift");

  assert.match(appDelegate, /nativeLoginPath = "\/native\/login"/, "the shell must target the native route");
  assert.match(appDelegate, /components\.path = nativeLoginPath/, "the resolved URL must carry the route path");
  assert.match(
    appDelegate,
    /webView\.url\?\.path == AppDelegate\.nativeLoginPath/,
    "the startup load must be skipped only when already on the native route",
  );
});
