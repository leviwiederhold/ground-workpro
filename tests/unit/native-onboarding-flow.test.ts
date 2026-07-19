import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { NATIVE_ENTRY_ROUTE, NATIVE_LOGIN_ROUTE, WEB_LOGIN_ROUTE } from "../../src/lib/auth/loginFlow.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const gate = () => read("app/components/OnboardingGate.tsx");
const entry = () => read("app/native/page.tsx");
const login = () => read("app/native/login/page.tsx");

// ── The original onboarding must still be the original ───────────────────────
// These pin the actual slide content so a future edit can't quietly redesign it.

test("all six original feature slides survive, in order, with original copy", () => {
  const source = gate();

  const expected = [
    "Your command center",
    "Fleet management",
    "Smart scheduling",
    "Team messaging",
    "Job costing",
    "Safety & compliance",
  ];

  let cursor = -1;
  for (const title of expected) {
    const index = source.indexOf(title);
    assert.ok(index > 0, `slide "${title}" must still exist`);
    assert.ok(index > cursor, `slide "${title}" must keep its original position`);
    cursor = index;
  }

  // Spot-check body copy that would be lost in a rewrite-from-memory.
  assert.match(source, /all from one dashboard built for dirt work/);
  assert.match(source, /Catch margin drift before it becomes a problem/);
  assert.match(source, /Toolbox talks, incident logs, and certifications/);
});

test("carousel chrome is intact: skip, dots, and Next/Get started", () => {
  const source = gate();
  assert.match(source, /className="skip-btn"/, "Skip button must remain");
  assert.match(source, /className="dots"/, "progress dots must remain");
  assert.match(source, /className={`dot\$\{index === slide \? " active" : ""\}`}/, "active dot state must remain");
  assert.match(source, /slide === features\.length - 1 \? "Get started" : "Next"/, "Next/Get started must remain");
});

test("the original entry choices are preserved and not collapsed into one card", () => {
  const source = gate();

  // Company / employee / existing-account are three distinct actions.
  assert.match(source, /Already part of a company\?/);
  assert.match(source, /I&apos;m an employee/);
  assert.match(source, /Already have an account\? Sign In/);

  assert.match(source, /onClick=\{\(\) => goTo\("company-access"\)\}/, "company path must remain");
  assert.match(source, /onClick=\{\(\) => goTo\("employee-invite"\)\}/, "employee path must remain");
  assert.match(source, /onClick=\{goToLogin\}/, "existing-account path must remain");
});

test("back buttons and the join-invite path are unchanged", () => {
  const source = gate();
  const backButtons = source.match(/className="back-btn"/g) ?? [];
  assert.ok(backButtons.length >= 3, `expected the original back buttons, found ${backButtons.length}`);

  // Join-team still validates the code then hands off to the web signup flow.
  assert.match(source, /\/api\/invite\/validate/, "invite validation must be unchanged");
  assert.match(
    source,
    /window\.location\.href = `\/signup\?invite=1&token=\$\{encodeURIComponent\(token\)\}`/,
    "join-team must still route to the existing signup invite flow",
  );
});

test("company signup is still directed to the web, not reinvented natively", () => {
  const source = gate();
  assert.match(source, /New company signup is available on the web/);
  assert.match(source, /Company signup and subscription setup are handled on the Groundwork Pro website/);
  // No native billing was invented.
  assert.ok(!source.includes("stripe"), "no native Stripe/billing behaviour may be introduced");
});

test("the onboarding styling is reused verbatim, not reimplemented", () => {
  const styles = read("app/components/native/onboardingStyles.ts");
  for (const selector of [
    ".gw-onboarding .feature-icon",
    ".gw-onboarding .dot.active",
    ".gw-onboarding .role-card",
    ".gw-onboarding .nav-tabs",
    ".gw-onboarding .primary-btn",
  ]) {
    assert.ok(styles.includes(selector), `original style ${selector} must be preserved`);
  }
  assert.match(gate(), /NATIVE_ONBOARDING_CSS/, "the gate must consume the shared stylesheet");
});

// ── Native startup goes to onboarding, not straight to login ─────────────────
test("the app starts at the onboarding entry route, NOT at the login card", () => {
  assert.equal(NATIVE_ENTRY_ROUTE, "/native");
  assert.equal(NATIVE_LOGIN_ROUTE, "/native/login");
  assert.ok(existsSync(join(repoRoot, "app/native/page.tsx")), "the onboarding entry route must exist");

  const appDelegate = read("ios/App/App/AppDelegate.swift");
  assert.match(appDelegate, /nativeEntryPath = "\/native"/, "the shell must start at the onboarding route");
  assert.match(appDelegate, /components\.path = nativeEntryPath/);
  assert.ok(
    !/nativeLoginPath\s*=/.test(appDelegate),
    "the shell must no longer start directly at the login route",
  );
});

test("first-time native launch renders the original onboarding slides", () => {
  const source = entry();
  assert.match(source, /<OnboardingGate/, "the entry route must render the ORIGINAL gate component");
  assert.match(source, /from "@\/app\/components\/OnboardingGate"/, "it must import the original, not a copy");
  // Nothing may pre-empt the carousel for a logged-out user.
  assert.ok(!source.includes("Continue with Apple"), "the entry route must not show the login card");
});

test("choosing log in navigates to the dedicated login route", () => {
  assert.match(entry(), /onRequestLogin=\{\(\) => router\.push\(NATIVE_LOGIN_ROUTE\)\}/);

  // And the gate honours that hand-off while keeping its original fallback.
  const source = gate();
  assert.match(source, /if \(onRequestLogin\)[\s\S]{0,80}onRequestLogin\(\);/);
  assert.match(source, /goTo\("employer-auth"\)/, "the original in-place screen must remain as the default");
});

// ── The login step ───────────────────────────────────────────────────────────
test("/native/login shows Apple, Google, and Email in order", () => {
  const source = login();
  const apple = source.indexOf("Continue with Apple");
  const google = source.indexOf("Continue with Google");
  const email = source.indexOf("Continue with Email");
  assert.ok(apple > 0 && google > apple && email > google, "expected Apple, then Google, then Email");
});

test("/native/login keeps the original login-screen design and navigation", () => {
  const source = login();
  assert.match(source, /NATIVE_ONBOARDING_CSS/, "it must reuse the original stylesheet");
  assert.match(source, /className="nav-tabs"/, "the original Log in / Join invite tabs must remain");
  assert.match(source, /Join invite/);
  assert.match(source, /className="back-btn"/, "the back button must remain");
  assert.match(source, /router\.push\("\/native"\)/, "back must return to onboarding");
  assert.match(source, /Sign in to Groundwork Pro/, "the original heading must remain");
  assert.match(source, /Use your existing employee or company account\./, "the original subcopy must remain");
});

test("email fields stay hidden until Continue with Email is tapped", () => {
  const source = login();
  assert.match(source, /const \[showEmailForm, setShowEmailForm\] = useState\(false\)/);
  assert.match(source, /onClick=\{\(\) => setShowEmailForm\(true\)\}/);

  const formIndex = source.indexOf('data-testid="native-email-form"');
  const emailInput = source.indexOf('data-testid="onboarding-login-email"');
  assert.ok(formIndex > 0 && emailInput > formIndex, "the email input must live inside the gated form");
  assert.match(source, /showEmailForm \? \(/, "the form must be conditional");
});

test("provider buttons are not gated behind runtime detection", () => {
  const source = login();
  const start = source.indexOf('data-testid="native-provider-buttons"');
  const end = source.indexOf('data-testid="native-continue-with-email"');
  const block = source.slice(start, end);
  for (const forbidden of ["nativeRuntime", "localStorage", "detectNativeLoginRuntime"]) {
    assert.ok(!block.includes(forbidden), `buttons must not be gated on ${forbidden}`);
  }
});

// ── Sessions, invites, sign-out ──────────────────────────────────────────────
test("authenticated native users bypass onboarding and login entirely", () => {
  assert.match(entry(), /if \(data\.session\)[\s\S]{0,200}router\.replace\("\/"\)/, "onboarding must be skipped");
  assert.match(login(), /getSession\(\)[\s\S]{0,300}routeAfterAuth\(\)/, "login must not trap a signed-in user");
});

test("onboarding is not replayed for a signed-in user, matching prior behaviour", () => {
  // There was NO onboarding-completed persistence key before this branch; the
  // session was the gate. Assert we did not invent one.
  const source = entry();
  assert.ok(
    !/localStorage\.(get|set)Item\(\s*["'][^"']*onboard/i.test(source),
    "no onboarding-completion flag may be invented",
  );
  assert.match(source, /getSession/, "session presence remains the gate, as before");
});

test("pending invites survive provider login", () => {
  const source = login();
  assert.match(source, /writePendingInviteState\(readPendingInviteFromSearch/, "invite state persisted before the sheet");
  assert.match(source, /resolveNativePostAuthDestination/, "post-auth routing goes through the shared resolver");

  const flow = read("src/lib/auth/loginFlow.ts");
  assert.doesNotMatch(
    flow.slice(flow.indexOf("resolveNativePostAuthDestination")),
    /bootstrap/,
    "an invited user must never hit company bootstrap (duplicate workspace risk)",
  );
});

test("no duplicate auth implementation was introduced", () => {
  const source = login();
  assert.match(source, /signInWithAppleNative|signInWithGoogleNative/, "the shared handlers must be reused");
  assert.match(source, /from "@\/lib\/auth\/loginFlow"/, "shared invite/membership logic must be reused");
});

// ── Web is untouched ─────────────────────────────────────────────────────────
test("web /login is unchanged and shows no native slides or providers", () => {
  const web = read("app/login/page.tsx");
  assert.equal(WEB_LOGIN_ROUTE, "/login");
  assert.match(web, /OAuthButtons/, "web OAuth must remain");
  for (const nativeOnly of ["gw-onboarding", "signInWithAppleNative", "useNativeLoginDiagnostics", "OnboardingGate"]) {
    assert.ok(!web.includes(nativeOnly), `/login must not contain ${nativeOnly}`);
  }
});

test("the native slides never render on the web", () => {
  // The gate is rendered only behind the native runtime check on the root route,
  // and on the /native route which the website never links to.
  const root = read("app/page.tsx");
  assert.match(root, /nativeRuntime \? \(\s*<OnboardingGate/, "root must keep its native-only guard");
});

// ── Diagnostics ──────────────────────────────────────────────────────────────
test("no diagnostics UI is rendered on any native screen", () => {
  const diagnostics = read("app/components/debug/useNativeLoginDiagnostics.ts");
  assert.match(diagnostics, /ground-workpro\.vercel\.app/, "production must be excluded");
  assert.ok(!diagnostics.includes("<details"), "the visible diagnostics panel must be removed");
  assert.ok(!diagnostics.includes("diagnostics (preview only)"), "the visible summary label must be gone");

  // Neither native screen renders a diagnostics element.
  for (const [name, source] of [["onboarding", entry()], ["login", login()]] as const) {
    assert.ok(!source.includes("<NativeLoginDiagnostics"), `${name} must not render diagnostics`);
    assert.ok(!source.includes("preview only"), `${name} must not show a diagnostics panel`);
  }

  // Logging is retained for development.
  assert.match(login(), /useNativeLoginDiagnostics\(\);/);
  assert.match(diagnostics, /console\.log/, "console diagnostics must be retained");
});

// ── Middleware ───────────────────────────────────────────────────────────────
test("both native routes are public", () => {
  const middleware = read("middleware.ts");
  assert.match(middleware, /"\/native"/, "/native must be public");
  assert.match(middleware, /"\/native\/login"/, "/native/login must be public");
});
