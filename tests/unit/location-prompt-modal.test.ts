import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  LOCATION_PROMPT_DISMISSED_KEY,
  clearLocationPromptDismissed,
  markLocationPromptDismissed,
  resolveLocationPromptDecision,
  shouldShowPassivePrompt,
  wasLocationPromptDismissed,
} from "../../src/lib/jobsite-time/locationPromptSession.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const modal = () => read("app/components/location/LocationPermissionModal.tsx");
const hook = () => read("app/components/location/useLocationPermissionPrompt.tsx");
const card = () => read("app/components/views/JobsiteTimeEmployeeCard.tsx");
const page = () => read("app/page.tsx");

function fakeStorage(seed: Record<string, string> = {}): Storage {
  const store = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  } as unknown as Storage;
}

// ── The ribbon is gone ───────────────────────────────────────────────────────
/** Strip comments so assertions test rendered code, not prose about it. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

test("no location ribbon remains on the dashboard", () => {
  const source = withoutComments(card());

  assert.ok(!source.includes("Allow location"), "the 'Allow location' ribbon must be removed");
  assert.ok(!source.includes("Location on"), "ribbon status text must be removed");
  assert.ok(!source.includes("Location off"), "ribbon status text must be removed");
  assert.ok(!source.includes("<button"), "the component must render no buttons");
  assert.match(source, /return null;/, "the component must render nothing");

  // The old always-on inline gate is gone from the clock-in modal too.
  assert.ok(
    !existsSync(join(repoRoot, "app/components/views/LocationPermissionGate.tsx")),
    "the superseded inline gate component must be removed",
  );
  assert.ok(!page().includes("LocationPermissionGate"), "app/page.tsx must not reference the old gate");
});

test("the dashboard never requests permission on load", () => {
  const source = withoutComments(card());
  // Only the NON-prompting check may be used here; the interactive request
  // (which surfaces the OS dialog) must not appear on a dashboard-mounted path.
  assert.match(source, /checkLocationPermission/, "must use the non-prompting check");
  assert.ok(
    !source.includes("requestLocationPermissionInteractive"),
    "the dashboard must never trigger the permission dialog on load",
  );
});

test("the geofence watcher still runs when permission is already granted", () => {
  const source = card();
  assert.match(source, /startForegroundGeofenceWatch/, "the watcher must be preserved");
  assert.match(source, /permission !== 'granted'/, "it must still be gated on granted permission");
});

// ── Copy ─────────────────────────────────────────────────────────────────────
test("the modal uses the exact required copy", () => {
  const source = modal();

  assert.match(source, /title: 'Enable location access'/);
  assert.match(
    source,
    /Groundwork Pro uses your location to improve attendance accuracy and confirm jobsite activity\./,
  );
  assert.match(
    source,
    /Your location is only used when required for work features and is not continuously tracked\./,
  );
  assert.match(source, /primary: 'Enable location'/);
  assert.match(source, /secondary: 'Not now'/);
});

// ── Web + native share one component ─────────────────────────────────────────
test("one modal serves both web and native", () => {
  const source = modal();

  // The platform branch lives in the shared helper, not in duplicated UI.
  assert.match(source, /requestLocationPermissionInteractive/, "must reuse the shared request helper");

  const helper = read("src/lib/jobsite-time/locationPermission.ts");
  assert.match(helper, /@capacitor\/geolocation/, "native path uses the Capacitor plugin");
  assert.match(helper, /navigator\.geolocation\.getCurrentPosition/, "web path uses getCurrentPosition");

  // Denial guidance differs by platform but comes from the same component.
  assert.match(source, /isNativeApp\(\)/);
  assert.match(source, /Privacy & Security → Location Services/, "iOS Settings instructions");
  assert.match(source, /site settings/, "browser instructions");
});

test("granting never navigates or reloads", () => {
  const source = modal();
  for (const forbidden of ["location.reload", "location.assign", "location.href", "router.refresh", "router.push"]) {
    assert.ok(!source.includes(forbidden), `modal must not ${forbidden}`);
  }
  const h = hook();
  for (const forbidden of ["location.reload", "location.assign", "router.refresh"]) {
    assert.ok(!h.includes(forbidden), `hook must not ${forbidden}`);
  }
  // Success closes immediately via onGranted.
  assert.match(source, /if \(next === 'granted'\)[\s\S]{0,120}onGranted\(\)/);
});

test("denial offers a Try again action", () => {
  const source = modal();
  assert.match(source, /'Try again'/, "denied/unavailable states must offer Try again");
  assert.match(source, /data-testid="location-denied"/);
  assert.match(source, /data-testid="location-unavailable"/);
});

test("permission is only requested from the user's tap, never on mount", () => {
  const source = modal();
  // The request function must be wired to onClick, and must not be called in an effect.
  assert.match(source, /onClick=\{request\}/, "request must be tap-driven");
  assert.ok(!/useEffect\([\s\S]{0,200}request\(\)/.test(source), "must not request on mount");
});

// ── Session persistence ──────────────────────────────────────────────────────
test("'Not now' is remembered for the session only", () => {
  const storage = fakeStorage();
  assert.equal(wasLocationPromptDismissed(storage), false);

  markLocationPromptDismissed(storage);
  assert.equal(storage.getItem(LOCATION_PROMPT_DISMISSED_KEY), "1");
  assert.equal(wasLocationPromptDismissed(storage), true);

  clearLocationPromptDismissed(storage);
  assert.equal(wasLocationPromptDismissed(storage), false);
});

test("dismissal uses sessionStorage, never localStorage", () => {
  const h = hook();
  assert.match(h, /window\.sessionStorage/, "dismissal must be session-scoped");
  assert.ok(!h.includes("localStorage"), "a dismissal must never persist across sessions");
});

test("unavailable storage never breaks the flow", () => {
  const hostile = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
    removeItem: () => {
      throw new Error("denied");
    },
  } as unknown as Storage;

  assert.doesNotThrow(() => markLocationPromptDismissed(hostile));
  assert.equal(wasLocationPromptDismissed(hostile), false);
  assert.doesNotThrow(() => clearLocationPromptDismissed(hostile));
  assert.doesNotThrow(() => markLocationPromptDismissed(null));
  assert.equal(wasLocationPromptDismissed(undefined), false);
});

// ── Decision logic ───────────────────────────────────────────────────────────
test("granted proceeds; denied/unavailable block; prompt asks", () => {
  assert.equal(resolveLocationPromptDecision({ permission: "granted" }), "proceed");
  assert.equal(resolveLocationPromptDecision({ permission: "denied" }), "blocked");
  assert.equal(resolveLocationPromptDecision({ permission: "unavailable" }), "blocked");
  assert.equal(resolveLocationPromptDecision({ permission: "prompt" }), "prompt");
  assert.equal(resolveLocationPromptDecision({ permission: "checking" }), "prompt");
});

test("a session dismissal does NOT permanently suppress the prompt", () => {
  // Passive surfaces respect the dismissal...
  assert.equal(
    shouldShowPassivePrompt({ permission: "prompt", dismissedThisSession: true, userInitiated: false }),
    false,
  );
  // ...but an explicit clock-in/out attempt asks again.
  assert.equal(
    shouldShowPassivePrompt({ permission: "prompt", dismissedThisSession: true, userInitiated: true }),
    true,
  );
  // Already granted → never ask.
  assert.equal(
    shouldShowPassivePrompt({ permission: "granted", dismissedThisSession: false, userInitiated: true }),
    false,
  );
});

// ── Clock-in/out wiring ──────────────────────────────────────────────────────
test("clock in and clock out are both blocked until location is granted", () => {
  const source = page();

  const clockIn = source.slice(source.indexOf("const handleClockIn"), source.indexOf("const handleClockOut"));
  assert.match(
    clockIn,
    /if \(!\(await ensureLocation\(\)\)\) return;/,
    "clock in must bail out when permission is not granted",
  );
  // The guard must precede the API call.
  assert.ok(
    clockIn.indexOf("ensureLocation") < clockIn.indexOf("/api/time-clock/clock-in"),
    "the location check must run before the clock-in request",
  );

  const clockOut = source.slice(source.indexOf("const handleClockOut"));
  assert.match(clockOut.slice(0, 400), /if \(!\(await ensureLocation\(\)\)\) return;/);
  assert.ok(
    clockOut.indexOf("ensureLocation") < clockOut.indexOf("/api/time-clock/clock-out"),
    "the location check must run before the clock-out request",
  );
});

test("ensureLocation resolves true without prompting when already granted", () => {
  const h = hook();
  assert.match(h, /checkLocationPermission\(\)/, "must check non-interactively first");
  assert.match(h, /if \(current === 'granted'\) return true;/, "granted users are never interrupted");
});

test("the modal is rendered on demand, not mounted on the dashboard", () => {
  const source = page();
  // It lives inside the time clock modal, alongside the clock buttons.
  assert.match(source, /\{locationModal\}/);
  const dashboardCase = source.slice(source.indexOf("case 'dashboard':"), source.indexOf("case 'messages':"));
  assert.ok(
    !dashboardCase.includes("locationModal") && !dashboardCase.includes("LocationPermissionModal"),
    "the dashboard must not mount the location modal",
  );
});
