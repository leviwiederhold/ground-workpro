import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  LOCATION_GATE_COPY,
  resolveGateAction,
  resolveGateBody,
  resolveGateButtonLabel,
  resolveLocationGateStatus,
} from "../../src/lib/jobsite-time/locationGate.ts";
import { locationSettingsInstructions } from "../../src/lib/runtime/openAppSettings.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const gate = () => read("app/components/location/LocationRequiredGate.tsx");
const card = () => read("app/components/views/JobsiteTimeEmployeeCard.tsx");
const page = () => read("app/page.tsx");

/** Strip comments so assertions test code, not prose about it. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

// ── The gate blocks the app ──────────────────────────────────────────────────
test("status resolves so the dashboard never renders before permission", () => {
  // 'checking' must be its own state — rendering the app OR the gate during it
  // would flicker.
  assert.equal(resolveLocationGateStatus("checking"), "checking");
  assert.equal(resolveLocationGateStatus(null), "checking");
  assert.equal(resolveLocationGateStatus(undefined), "checking");

  assert.equal(resolveLocationGateStatus("granted"), "granted");
  for (const state of ["prompt", "denied", "unavailable"] as const) {
    assert.equal(resolveLocationGateStatus(state), "blocked", `${state} must block the app`);
  }
});

test("app/page.tsx renders nothing while checking, then the gate, then the app", () => {
  const source = code(page());

  const checking = source.indexOf("if (locationGate === 'checking')");
  const blocked = source.indexOf("if (locationGate !== 'granted')");
  const app = source.indexOf("return <App currentUser={currentUser}");

  assert.ok(checking > 0 && blocked > checking, "the checking branch must precede the gate branch");
  assert.ok(app > blocked, "the app must render only after both location branches");
  assert.match(source, /if \(locationGate === 'checking'\) \{\s*return null;/, "checking renders nothing");
  assert.match(source, /return <LocationRequiredGate onGranted=/, "blocked renders the gate");
});

test("permission is checked after authentication, without prompting", () => {
  const source = code(page());
  assert.match(source, /if \(!isAuthenticated\)[\s\S]{0,120}setLocationGate\('checking'\)/);
  assert.match(source, /checkLocationPermission/, "must use the non-prompting check");
  assert.ok(
    !source.includes("requestLocationPermissionInteractive"),
    "app/page.tsx must never trigger the OS dialog itself",
  );
});

// ── Exactly one permission experience ────────────────────────────────────────
test("all feature-level permission UI is gone", () => {
  assert.ok(
    !existsSync(join(repoRoot, "app/components/views/LocationPermissionGate.tsx")),
    "the inline clock-in gate must be deleted",
  );
  assert.ok(
    !existsSync(join(repoRoot, "app/components/location/LocationPermissionModal.tsx")),
    "no separate permission modal may exist",
  );
  assert.ok(
    !existsSync(join(repoRoot, "app/components/location/useLocationPermissionPrompt.tsx")),
    "the action-level prompt hook must not exist",
  );

  const source = code(page());
  assert.ok(!source.includes("LocationPermissionGate"), "no reference to the old gate");
  assert.ok(!source.includes("ensureLocation"), "no action-level ensureLocation gating");
});

test("no location ribbon remains, and the dashboard never prompts", () => {
  const source = code(card());
  assert.ok(!source.includes("Allow location"), "the ribbon must be removed");
  assert.ok(!source.includes("<button"), "the component must render no controls");
  assert.match(source, /return null;/, "the component must render nothing");
  assert.ok(
    !source.includes("requestLocationPermissionInteractive"),
    "the dashboard must never raise the OS dialog",
  );
});

test("exactly one component requests permission", () => {
  const requesters = ["app/components/location/LocationRequiredGate.tsx"];
  for (const rel of requesters) {
    assert.match(read(rel), /requestLocationPermissionInteractive/);
  }
  // Nothing else in the app may call it.
  const others = [
    "app/page.tsx",
    "app/components/views/JobsiteTimeEmployeeCard.tsx",
  ];
  for (const rel of others) {
    assert.ok(
      !code(read(rel)).includes("requestLocationPermissionInteractive"),
      `${rel} must not request permission`,
    );
  }
});

// ── Attendance preserved ─────────────────────────────────────────────────────
test("the geofence watcher still starts automatically once granted", () => {
  const source = card();
  assert.match(source, /startForegroundGeofenceWatch/, "the watcher must be preserved");
  assert.match(source, /permission !== 'granted'/, "still gated on granted permission");
  assert.match(source, /checkLocationPermission/, "permission is read non-interactively");
});

// ── Copy ─────────────────────────────────────────────────────────────────────
test("the gate uses the exact required copy", () => {
  assert.equal(LOCATION_GATE_COPY.title, "Enable location");
  assert.equal(
    LOCATION_GATE_COPY.body,
    "Please enable location to improve your experience with Groundwork Pro.",
  );
  assert.equal(LOCATION_GATE_COPY.request, "Enable location");
  assert.equal(LOCATION_GATE_COPY.deniedBody, "Location is required to continue using Groundwork Pro.");
  assert.equal(LOCATION_GATE_COPY.retry, "Try Again");
  assert.equal(LOCATION_GATE_COPY.settings, "Open Settings");
});

test("the body switches to the required message after a denial", () => {
  assert.equal(resolveGateBody(null), LOCATION_GATE_COPY.body);
  assert.equal(resolveGateBody("granted"), LOCATION_GATE_COPY.body);
  assert.equal(resolveGateBody("denied"), LOCATION_GATE_COPY.deniedBody);
  assert.equal(resolveGateBody("unavailable"), LOCATION_GATE_COPY.deniedBody);
});

// ── Retry vs Settings ────────────────────────────────────────────────────────
test("a retryable platform keeps offering the request", () => {
  assert.equal(resolveGateAction({ permission: "prompt", lastResult: null }), "request");
  assert.equal(resolveGateAction({ permission: "prompt", lastResult: "denied" }), "request");
  assert.equal(resolveGateAction({ permission: "checking", lastResult: null }), "request");
  assert.equal(resolveGateAction({ permission: "unavailable", lastResult: "unavailable" }), "request");
});

test("a permanently denied platform offers Settings instead of a dead retry", () => {
  // Once the platform reports denied the dialog will not reappear, so "Try
  // Again" would silently do nothing.
  assert.equal(resolveGateAction({ permission: "denied", lastResult: "denied" }), "settings");
  assert.equal(resolveGateAction({ permission: "denied", lastResult: null }), "settings");
});

test("button labels follow the state machine", () => {
  assert.equal(
    resolveGateButtonLabel({ action: "request", lastResult: null }),
    "Enable location",
    "first ask",
  );
  assert.equal(
    resolveGateButtonLabel({ action: "request", lastResult: "denied" }),
    "Try Again",
    "after a denial that can still be retried",
  );
  assert.equal(
    resolveGateButtonLabel({ action: "settings", lastResult: "denied" }),
    "Open Settings",
    "permanently denied",
  );
});

// ── No escape hatches ────────────────────────────────────────────────────────
test("the gate has no dismissal affordance of any kind", () => {
  const source = code(gate());

  for (const forbidden of ["Not now", "Not Now", "onDismiss", "onClose", "Escape", "keydown", "aria-label=\"Close\""]) {
    assert.ok(!source.includes(forbidden), `the gate must not contain ${forbidden}`);
  }

  // Exactly one button.
  const buttons = source.match(/<button/g) ?? [];
  assert.equal(buttons.length, 1, `expected exactly one action, found ${buttons.length}`);

  // No backdrop click handler.
  assert.ok(!/onClick=\{\(event\)/.test(source), "no backdrop dismissal handler");
});

test("granting dismisses the gate without navigating or reloading", () => {
  const source = gate();
  for (const forbidden of ["location.reload", "location.assign", "location.href =", "router.refresh", "router.push"]) {
    assert.ok(!source.includes(forbidden), `the gate must not ${forbidden}`);
  }
  assert.match(source, /if \(result === 'granted'\)[\s\S]{0,120}onGranted\(\)/);
});

test("the gate locks scrolling of anything behind it", () => {
  assert.match(code(gate()), /document\.body\.style\.overflow = 'hidden'/);
});

// ── Settings helper ──────────────────────────────────────────────────────────
test("settings can only be opened natively; the web falls back to instructions", () => {
  const helper = read("src/lib/runtime/openAppSettings.ts");
  assert.match(helper, /app-settings:/, "native opens the app settings URL");
  assert.match(helper, /_system/, "handed to the OS, not the in-app WebView");
  assert.match(helper, /return "unsupported"/, "web must report that it cannot open settings");

  // Both platforms get usable manual steps.
  assert.match(locationSettingsInstructions(true), /Privacy & Security/);
  assert.match(locationSettingsInstructions(false), /site settings/);

  // The gate shows instructions when opening is unsupported.
  assert.match(code(gate()), /if \(outcome === 'unsupported'\) setShowInstructions\(true\)/);
});

test("returning from Settings re-checks permission and lets the user in", () => {
  const source = code(gate());
  assert.match(source, /addEventListener\('focus'/, "re-check on foreground");
  assert.match(source, /visibilitychange/, "re-check on visibility change");
  assert.match(source, /if \(next === 'granted'\) onGranted\(\)/);
});
