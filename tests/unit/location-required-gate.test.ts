import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  isAttendanceParticipant,
  isAttendanceSetupComplete,
  LOCATION_CHECK_TIMEOUT_MS,
  LOCATION_GATE_COPY,
  resolveGateAction,
  resolveGateBody,
  resolveGateButtonLabel,
  resolveGateStatusWithTimeout,
  resolveLocationGateStatus,
  type LocationGateStatus,
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

// ── A permission check can never blank the app forever (Stage 1) ─────────────
test("a gate resolution that never settles cannot leave the app blank", async () => {
  // This is the physical-iPhone white screen: on native the Capacitor plugin
  // import / bridge call can hang, so the evaluation never resolves.
  const hang = () => new Promise<LocationGateStatus>(() => {});
  const status = await resolveGateStatusWithTimeout(hang, 20);
  assert.equal(status, "blocked", "a stalled check must fall back to the setup gate, not null");
});

test("a resolution that answers in time wins over the timeout", async () => {
  assert.equal(
    await resolveGateStatusWithTimeout(async () => "granted", LOCATION_CHECK_TIMEOUT_MS),
    "granted",
    "a complete setup must let the user in",
  );
  assert.equal(
    await resolveGateStatusWithTimeout(async () => "blocked", LOCATION_CHECK_TIMEOUT_MS),
    "blocked",
    "an incomplete setup must show the gate",
  );
});

test("a rejected or throwing resolution shows the gate rather than hanging", async () => {
  assert.equal(
    await resolveGateStatusWithTimeout(async () => {
      throw new Error("bridge failed");
    }, LOCATION_CHECK_TIMEOUT_MS),
    "blocked",
    "a rejected check must fall back to the setup gate",
  );
  assert.equal(
    await resolveGateStatusWithTimeout(() => {
      throw new Error("synchronous failure");
    }, LOCATION_CHECK_TIMEOUT_MS),
    "blocked",
    "a synchronously-throwing check must fall back to the setup gate",
  );
});

test("the startup gate bounds its evaluation so it cannot render null forever", () => {
  const source = code(read("app/components/location/RequireLocationAccess.tsx"));
  // The evaluation must go through the bounded helper, not a bare await that can
  // stall on native and strand the app on 'checking' → null.
  assert.match(
    source,
    /resolveGateStatusWithTimeout\(evaluate/,
    "the evaluation must be time-bounded",
  );
  // Stage 1/2 constraint: the fix must not redirect or reload.
  for (const forbidden of ["location.reload", "location.assign", "location.href", "router.push", "router.replace", "router.refresh"]) {
    assert.ok(!source.includes(forbidden), `the wrapper must not ${forbidden}`);
  }
});

// ── Only attendance participants are gated (Stage 2, assignment-based) ────────
test("participation is by job assignment, not a role allowlist", () => {
  // Assigned to at least one job → participant (regardless of role: an assigned
  // PM/operations user participates and is gated).
  assert.equal(isAttendanceParticipant({ assignedJobCount: 1 }), true, "one assignment participates");
  assert.equal(isAttendanceParticipant({ assignedJobCount: 5 }), true, "many assignments participate");
  // No assignment → not a participant (a CEO/executive/admin-only user with no
  // jobs is never gated just for being authenticated).
  assert.equal(isAttendanceParticipant({ assignedJobCount: 0 }), false, "no assignment does not participate");
});

test("the wrapper gates by assignment, not by role", () => {
  const source = code(read("app/components/location/RequireLocationAccess.tsx"));
  // Participation is derived from the authoritative assignment source.
  assert.match(source, /isAttendanceParticipant/, "must gate by attendance participation");
  assert.match(source, /fetchAssignedJobs\(\)/, "participation comes from assigned jobs (job_employees)");
  // No role allowlist anywhere in the gating decision.
  assert.ok(!/participatesInAutomaticAttendance/.test(source), "must not use a role allowlist");
  assert.ok(!/readCachedUiRole/.test(source), "must not decide participation from cached role");
});

// ── Native requires a device credential; web does not (Stage 2) ──────────────
test("native setup requires location AND a device credential", () => {
  assert.equal(
    isAttendanceSetupComplete({ platform: "native", permission: "granted", hasDeviceCredential: true }),
    true,
    "native: granted + credential is complete",
  );
  assert.equal(
    isAttendanceSetupComplete({ platform: "native", permission: "granted", hasDeviceCredential: false }),
    false,
    "native: granted without a credential is NOT complete",
  );
  assert.equal(
    isAttendanceSetupComplete({ platform: "native", permission: "denied", hasDeviceCredential: true }),
    false,
    "native: no permission is never complete",
  );
});

test("web setup requires only location — never a native credential", () => {
  assert.equal(
    isAttendanceSetupComplete({ platform: "web", permission: "granted", hasDeviceCredential: false }),
    true,
    "web: granted is complete even with no credential (web has no secure store)",
  );
  assert.equal(
    isAttendanceSetupComplete({ platform: "web", permission: "prompt", hasDeviceCredential: false }),
    false,
    "web: without permission it is not complete",
  );
});

test("the gate enrolls a device credential on native, and exempts web", () => {
  const source = code(gate());
  assert.match(source, /enrollDeviceCredential/, "native completion must enroll a device credential");
  assert.match(source, /getNativeGeofenceHealth/, "must reuse existing native credential health");
  // completeSetup short-circuits on web (no secure store) so web is never locked out.
  assert.match(source, /if \(!native\) return true;/, "web requires no credential");
  // Reuses the strict Capacitor native check (a web session can't spoof native
  // and get locked out).
  assert.match(source, /isCapacitorNativePlatform/, "must use the strict native-platform check");
});

test("the wrapper renders nothing while checking, the gate when blocked, the route when granted", () => {
  const source = code(read("app/components/location/RequireLocationAccess.tsx"));

  assert.match(source, /if \(status === 'checking'\) return null;/, "checking renders nothing");
  assert.match(source, /if \(status !== 'granted'\)[\s\S]{0,120}<LocationRequiredGate/, "blocked renders the gate");
  assert.match(source, /return <>\{children\}<\/>;/, "granted renders the route");

  // Order matters: neither the content nor the gate may render before the answer.
  const checking = source.indexOf("status === 'checking'");
  const blocked = source.indexOf("status !== 'granted'");
  const content = source.indexOf("{children}");
  assert.ok(checking < blocked && blocked < content, "checking must be handled first");
});

test("the wrapper checks permission without ever prompting", () => {
  const source = code(read("app/components/location/RequireLocationAccess.tsx"));
  assert.match(source, /checkLocationPermission/, "must use the non-prompting check");
  assert.ok(
    !source.includes("requestLocationPermissionInteractive"),
    "the wrapper must never trigger the OS dialog itself",
  );
});

test("revoking permission raises the gate on focus or visibility change", () => {
  const source = code(read("app/components/location/RequireLocationAccess.tsx"));
  assert.match(source, /addEventListener\('focus'/, "must re-check on focus");
  assert.match(source, /visibilitychange/, "must re-check on visibility change");
  // sync() re-evaluates in BOTH directions, so a revoke downgrades a granted
  // session rather than being ignored.
  assert.match(source, /setStatus\(await evaluate\(\)\)/);
});

// ── Which routes are gated, and which are deliberately not ───────────────────
test("every protected route uses the shared wrapper, not duplicated logic", () => {
  const gated = {
    "app/page.tsx": "/ (and /settings, which re-exports it)",
    "app/profile/page.tsx": "/profile",
    "app/notifications/page.tsx": "/notifications",
  };
  for (const [rel, label] of Object.entries(gated)) {
    assert.match(read(rel), /RequireLocationAccess/, `${label} must be wrapped`);
  }

  // /settings re-exports the root page, so it inherits the gate.
  assert.match(read("app/settings/page.tsx"), /from "\.\.\/page"/, "/settings must re-export the root page");

  // The logic lives in ONE component.
  const wrapperCount = Object.keys(gated).filter((rel) =>
    /status === 'checking'/.test(read(rel)),
  ).length;
  assert.equal(wrapperCount, 0, "no route may reimplement the gate logic inline");
});

test("onboarding and auth routes are deliberately NOT gated", () => {
  const exempt = {
    "app/setup/page.tsx": "invited users must be able to finish account setup",
    "app/login/page.tsx": "sign-in must be reachable without location",
    "app/native/page.tsx": "native onboarding must be reachable without location",
    "app/native/login/page.tsx": "native sign-in must be reachable without location",
    "app/signup/page.tsx": "invite acceptance happens before setup",
  };
  for (const [rel, why] of Object.entries(exempt)) {
    assert.ok(!read(rel).includes("RequireLocationAccess"), `${rel} must NOT be gated — ${why}`);
  }
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
  // The card DOES render now — the attendance lifecycle state and a manual
  // fallback (PR 14). What it must never do is ask for permission itself: the
  // one permission experience is LocationRequiredGate. The non-prompting
  // checkLocationPermission() read is what belongs here.
  assert.ok(
    !source.includes("requestLocationPermissionInteractive"),
    "the dashboard must never raise the OS dialog",
  );
  assert.ok(
    source.includes("checkLocationPermission"),
    "the card must read permission non-prompting",
  );
  // No control on this card may be a permission request in disguise.
  assert.ok(
    !/onClick=\{[^}]*[Pp]ermission/.test(source),
    "no control on the card may trigger a permission request",
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

// ── Copy (Stage 2: attendance-specific) ──────────────────────────────────────
test("the gate uses the exact required copy", () => {
  assert.equal(LOCATION_GATE_COPY.title, "Enable location for attendance");
  assert.equal(LOCATION_GATE_COPY.request, "Enable location");
  assert.equal(LOCATION_GATE_COPY.retry, "Try Again");
  assert.equal(LOCATION_GATE_COPY.settings, "Open Settings");
});

test("the copy explains automatic jobsite attendance and disclaims continuous tracking", () => {
  for (const body of [LOCATION_GATE_COPY.body, LOCATION_GATE_COPY.deniedBody]) {
    assert.match(body, /jobsite attendance/i, "must name automatic jobsite attendance");
    assert.match(body, /arrive/i, "must mention arrival detection");
    assert.match(body, /leave/i, "must mention departure detection");
    assert.match(
      body,
      /does not continuously track/i,
      "must explicitly disclaim continuous tracking",
    );
  }
  // The generic pre-attendance copy is gone.
  assert.ok(
    !LOCATION_GATE_COPY.body.includes("continue using Groundwork Pro"),
    "the old generic copy must be replaced",
  );
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
  // Granting → finish setup (native credential) → dismiss via onGranted(). The
  // credential step sits between, so the two are not adjacent, but dismissal is
  // still a plain onGranted() with no navigation or reload.
  assert.match(source, /if \(result === 'granted'\)/, "handles a granted result");
  assert.match(source, /const ready = await completeSetup\(\);/, "finishes setup before dismissing");
  assert.match(source, /if \(ready\) \{\s*onGranted\(\);/, "dismisses only when setup is complete");
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
  // On return, a granted permission finishes setup and then dismisses.
  assert.match(source, /if \(next === 'granted'\)/, "acts on a granted result on return");
  assert.match(source, /if \(ready\) onGranted\(\)/, "dismisses once setup is complete");
});

// ── No header location prompt anywhere (Stage 2) ─────────────────────────────
test("there is no header/ribbon location prompt outside the single gate", () => {
  // The one and only permission experience is LocationRequiredGate. No header,
  // ribbon, or banner elsewhere may ask for or prompt location.
  for (const rel of [
    "app/page.tsx",
    "app/components/views/JobsiteTimeEmployeeCard.tsx",
  ]) {
    const source = code(read(rel));
    assert.ok(!source.includes("Allow location"), `${rel} must not show a location ribbon`);
    assert.ok(!source.includes("Enable location"), `${rel} must not show a location prompt (only the gate does)`);
    assert.ok(
      !source.includes("requestLocationPermissionInteractive"),
      `${rel} must not request permission`,
    );
  }
});
