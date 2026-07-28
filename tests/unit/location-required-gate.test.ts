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
  LOCATION_GATE_ERROR_COPY,
  locationSetupErrorKind,
  resolveGateAction,
  resolveGateBody,
  resolveGateButtonLabel,
  resolveGateStatusWithTimeout,
  resolveLocationGateStatus,
  runLocationSetup,
  type LocationGateStatus,
} from "../../src/lib/jobsite-time/locationGate.ts";
import { locationSettingsInstructions } from "../../src/lib/runtime/openAppSettings.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const gate = () => read("app/components/location/LocationRequiredGate.tsx");
const runtime = () => read("app/components/location/LocationBackgroundRuntime.tsx");
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
  assert.match(source, /fetchAssignedJobsRequired\(\)/, "participation comes from assigned jobs (job_employees)");
  // No role allowlist anywhere in the gating decision.
  assert.ok(!/participatesInAutomaticAttendance/.test(source), "must not use a role allowlist");
  assert.ok(!/readCachedUiRole/.test(source), "must not decide participation from cached role");
});

// ── Native requires a device credential; web does not (Stage 2) ──────────────
const completeNativeHealth = {
  supported: true,
  authorized: true,
  authorizationStatus: "authorized_always" as const,
  locationServicesEnabled: true,
  preciseLocation: true,
  registeredCount: 2,
  lastEventAt: null,
  lastEventTransition: null,
  lastError: null,
  pendingQueuedCount: 0,
  hasCredential: true,
};

test("native setup requires Always authorization, Precise Location, credential, and every assigned region", () => {
  const complete = {
    platform: "native" as const,
    permission: "granted" as const,
    hasDeviceCredential: true,
    nativeHealth: completeNativeHealth,
    requiredRegionIds: ["shop:arrival", "shop:wake"],
    registeredRegionIds: ["shop:arrival", "shop:wake"],
  };
  assert.equal(
    isAttendanceSetupComplete(complete),
    true,
    "all native requirements are complete",
  );
  assert.equal(
    isAttendanceSetupComplete({
      ...complete,
      nativeHealth: {
        ...completeNativeHealth,
        authorized: false,
        authorizationStatus: "authorized_when_in_use",
      },
    }),
    false,
    "foreground-only authorization must not dismiss the gate",
  );
  assert.equal(
    isAttendanceSetupComplete({
      ...complete,
      nativeHealth: { ...completeNativeHealth, preciseLocation: false },
    }),
    false,
    "reduced-accuracy location must not dismiss the gate",
  );
  assert.equal(
    isAttendanceSetupComplete({ ...complete, hasDeviceCredential: false }),
    false,
    "a missing secure credential must not dismiss the gate",
  );
  assert.equal(
    isAttendanceSetupComplete({ ...complete, registeredRegionIds: ["shop:arrival"] }),
    false,
    "every assigned region must be registered",
  );
  assert.equal(
    isAttendanceSetupComplete({ ...complete, permission: "denied" }),
    false,
    "revoked permission must raise the gate",
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
  assert.match(source, /requestDeviceCredential/, "native completion must mint a device credential");
  assert.match(source, /writeDeviceCredentialToSecureStore/, "native completion must write the credential securely");
  assert.match(source, /requireNativeGeofenceHealth/, "must verify the native geofence bridge");
  assert.match(source, /native,\s*checkPermission:/, "the pipeline must explicitly distinguish native from web");
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

test("the headless background runtime never renders or prompts", () => {
  const source = code(runtime());
  assert.ok(!source.includes("Allow location"), "the ribbon must be removed");
  assert.ok(
    !source.includes("requestLocationPermissionInteractive"),
    "the background runtime must never raise the OS dialog",
  );
  assert.ok(
    source.includes("checkLocationPermission"),
    "the runtime must read permission non-prompting",
  );
  assert.match(source, /return null;/, "the runtime must render no employee-facing UI");
  assert.ok(!/<button\b/.test(source), "the runtime must render no controls");
});

test("exactly one component requests permission", () => {
  const requesters = ["app/components/location/LocationRequiredGate.tsx"];
  for (const rel of requesters) {
    assert.match(read(rel), /requestLocationPermissionInteractive/);
  }
  // Nothing else in the app may call it.
  const others = [
    "app/page.tsx",
    "app/components/location/LocationBackgroundRuntime.tsx",
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
  const source = runtime();
  assert.match(source, /startForegroundGeofenceWatch/, "the watcher must be preserved");
  assert.match(source, /permission !== 'granted'/, "still gated on granted permission");
  assert.match(source, /checkLocationPermission/, "permission is read non-interactively");
});

// ── Copy (Stage 2: attendance-specific) ──────────────────────────────────────
// ── The enable state machine can never get stuck on "Requesting…" ────────────
const grant = async () => "granted" as const;
const deny = async () => "denied" as const;
const never = () => new Promise<never>(() => {}); // simulates a hung native call

const setupDeps = (overrides: Record<string, unknown> = {}) => ({
  native: true,
  checkPermission: grant,
  requestPermission: grant,
  checkNativeGeofenceHealth: async () => ({ ...completeNativeHealth, hasCredential: false }),
  requestBackgroundAuthorization: async () => {},
  enrollSecureCredential: async () => "credential",
  writeSecureCredential: async () => {},
  registerAssignedLocations: async () => ({
    requiredRegionIds: ["shop:arrival", "shop:wake"],
    registeredRegionIds: ["shop:arrival", "shop:wake"],
  }),
  verifyCompletion: async () => true,
  ...overrides,
});

test("success: already-granted permission completes every native setup boundary", async () => {
  const result = await runLocationSetup(setupDeps());
  assert.deepEqual(result, { status: "granted" });
});

test("first-time iOS request is checked, requested once, then checked again", async () => {
  let checks = 0;
  let requests = 0;
  const result = await runLocationSetup(
    setupDeps({
      checkPermission: async () => (++checks === 1 ? "prompt" as const : "granted" as const),
      requestPermission: async () => {
        requests += 1;
        return "granted" as const;
      },
    }),
  );
  assert.deepEqual(result, { status: "granted" });
  assert.equal(checks, 2);
  assert.equal(requests, 1);
});

test("already-granted permission never invokes the request call", async () => {
  let requests = 0;
  const result = await runLocationSetup(
    setupDeps({
      requestPermission: async () => {
        requests += 1;
        return "granted" as const;
      },
    }),
  );
  assert.deepEqual(result, { status: "granted" });
  assert.equal(requests, 0);
});

test("denial is terminal and identifies the checking stage", async () => {
  const result = await runLocationSetup(setupDeps({ checkPermission: deny }));
  assert.deepEqual(result, {
    status: "denied",
    stage: "checking_location_permission",
    code: "IOS_LOCATION_PERMISSION_DENIED",
  });
  assert.equal(locationSetupErrorKind(result), null);
});

test("every native setup stage has its own timeout code", async () => {
  const cases = [
    {
      stage: "checking_location_permission",
      code: "LOCATION_PERMISSION_CHECK_TIMEOUT",
      override: { checkPermission: never },
    },
    {
      stage: "requesting_location_permission",
      code: "LOCATION_PERMISSION_REQUEST_TIMEOUT",
      override: { checkPermission: async () => "prompt" as const, requestPermission: never },
    },
    {
      stage: "native_geofence_health",
      code: "NATIVE_GEOFENCE_HEALTH_TIMEOUT",
      override: { checkNativeGeofenceHealth: never },
    },
    {
      stage: "requesting_background_authorization",
      code: "BACKGROUND_AUTHORIZATION_REQUEST_TIMEOUT",
      override: {
        checkNativeGeofenceHealth: async () => ({
          ...completeNativeHealth,
          authorized: false,
          authorizationStatus: "authorized_when_in_use" as const,
        }),
        requestBackgroundAuthorization: never,
      },
    },
    {
      stage: "secure_credential_enrollment",
      code: "SECURE_CREDENTIAL_ENROLLMENT_TIMEOUT",
      override: { enrollSecureCredential: never },
    },
    {
      stage: "secure_store_write",
      code: "SECURE_STORE_WRITE_TIMEOUT",
      override: { writeSecureCredential: never },
    },
    {
      stage: "assigned_location_registration",
      code: "ASSIGNED_LOCATION_REGISTRATION_TIMEOUT",
      override: { registerAssignedLocations: never },
    },
    {
      stage: "completion",
      code: "LOCATION_SETUP_COMPLETION_TIMEOUT",
      override: {
        checkNativeGeofenceHealth: async () => completeNativeHealth,
        verifyCompletion: never,
      },
    },
  ] as const;

  for (const item of cases) {
    const result = await runLocationSetup(
      setupDeps({
        ...item.override,
        stageTimeoutMs: { [item.stage]: 15 },
      }),
    );
    assert.equal(result.status, "failed", `${item.stage} must fail`);
    if (result.status === "failed") {
      assert.equal(result.stage, item.stage);
      assert.equal(result.code, item.code);
      assert.equal(result.kind, "timeout");
      assert.equal(locationSetupErrorKind(result), item.code);
    }
  }
});

test("bridge, enrollment and Keychain failures retain their exact stage codes", async () => {
  const cases = [
    {
      code: "LOCATION_PERMISSION_CHECK_FAILED",
      override: { checkPermission: async () => { throw new Error("Geolocation unavailable"); } },
    },
    {
      code: "NATIVE_GEOFENCE_HEALTH_FAILED",
      override: { checkNativeGeofenceHealth: async () => { throw new Error("plugin unavailable"); } },
    },
    {
      code: "BACKGROUND_AUTHORIZATION_REQUEST_FAILED",
      override: {
        checkNativeGeofenceHealth: async () => ({
          ...completeNativeHealth,
          authorized: false,
          authorizationStatus: "authorized_when_in_use" as const,
        }),
        requestBackgroundAuthorization: async () => { throw new Error("bridge failed"); },
      },
    },
    {
      code: "SECURE_CREDENTIAL_ENROLLMENT_FAILED",
      override: { enrollSecureCredential: async () => { throw new Error("HTTP 401"); } },
    },
    {
      code: "SECURE_STORE_WRITE_FAILED",
      override: { writeSecureCredential: async () => { throw new Error("Keychain failed"); } },
    },
    {
      code: "ASSIGNED_LOCATION_REGISTRATION_FAILED",
      override: { registerAssignedLocations: async () => { throw new Error("registration failed"); } },
    },
    {
      code: "LOCATION_SETUP_COMPLETION_FAILED",
      override: {
        checkNativeGeofenceHealth: async () => completeNativeHealth,
        verifyCompletion: async () => false,
      },
    },
  ] as const;

  for (const item of cases) {
    const result = await runLocationSetup(setupDeps(item.override));
    assert.equal(result.status, "failed");
    if (result.status === "failed") assert.equal(result.code, item.code);
  }
});

test("setup diagnostics report every required native boundary", async () => {
  const transitions: Array<{ stage: string; state: string }> = [];
  const result = await runLocationSetup(
    setupDeps({
      onTransition: (transition: { stage: string; state: string }) => transitions.push(transition),
    }),
  );
  assert.deepEqual(result, { status: "granted" });
  assert.deepEqual(
    transitions.filter((transition) => transition.state === "started").map((transition) => transition.stage),
    [
      "checking_location_permission",
      "native_geofence_health",
      "secure_credential_enrollment",
      "secure_store_write",
      "assigned_location_registration",
      "completion",
    ],
  );
  assert.ok(
    transitions.some(
      (transition) =>
        transition.stage === "requesting_location_permission" && transition.state === "skipped",
    ),
  );
  assert.ok(
    transitions.some(
      (transition) =>
        transition.stage === "requesting_background_authorization" &&
        transition.state === "skipped",
    ),
  );
});

test("foreground-only iOS authorization stays in the neutral Settings flow", async () => {
  let healthChecks = 0;
  let enrollmentCalls = 0;
  const result = await runLocationSetup(
    setupDeps({
      checkNativeGeofenceHealth: async () => {
        healthChecks += 1;
        return {
          ...completeNativeHealth,
          authorized: false,
          authorizationStatus: "authorized_when_in_use" as const,
          hasCredential: false,
        };
      },
      enrollSecureCredential: async () => {
        enrollmentCalls += 1;
        return "credential";
      },
    }),
  );
  assert.deepEqual(result, {
    status: "settings_required",
    stage: "native_geofence_health",
    code: "IOS_BACKGROUND_LOCATION_REQUIRED",
  });
  assert.equal(healthChecks, 2, "authorization must be re-read after requesting Always");
  assert.equal(enrollmentCalls, 0, "incomplete authorization must not advance setup");
});

test("disabled Precise Location stays in the neutral Settings flow", async () => {
  const result = await runLocationSetup(
    setupDeps({
      checkNativeGeofenceHealth: async () => ({
        ...completeNativeHealth,
        preciseLocation: false,
      }),
    }),
  );
  assert.deepEqual(result, {
    status: "settings_required",
    stage: "native_geofence_health",
    code: "IOS_PRECISE_LOCATION_REQUIRED",
  });
});

test("setup cannot complete until every assigned region is registered", async () => {
  const result = await runLocationSetup(
    setupDeps({
      registerAssignedLocations: async () => ({
        requiredRegionIds: ["shop:arrival", "shop:wake"],
        registeredRegionIds: ["shop:arrival"],
      }),
    }),
  );
  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.code, "ASSIGNED_LOCATION_REGISTRATION_FAILED");
  }
});

test("every failure code has exact visible copy", () => {
  for (const [code, message] of Object.entries(LOCATION_GATE_ERROR_COPY)) {
    assert.ok(message.length > 0, `${code} needs a message`);
  }
  assert.equal(
    LOCATION_GATE_ERROR_COPY.LOCATION_PERMISSION_REQUEST_TIMEOUT,
    "Timed out requesting iOS location permission.",
  );
  assert.equal(
    LOCATION_GATE_ERROR_COPY.NATIVE_GEOFENCE_HEALTH_TIMEOUT,
    "Timed out verifying location services.",
  );
  assert.equal(
    LOCATION_GATE_ERROR_COPY.SECURE_CREDENTIAL_ENROLLMENT_TIMEOUT,
    "Timed out completing secure location setup.",
  );
});

test("the gate bundles a visible SVG location icon without global icon CSS", () => {
  const source = code(gate());
  assert.match(source, /<svg[\s\S]*data-testid="location-gate-icon"/, "must render the bundled icon component");
  assert.match(source, /<path d="M20 10c0 5-8 11-8 11S4 15 4 10/, "must contain the map-pin shape");
  assert.ok(!source.includes("fa-location"), "must not depend on Font Awesome location CSS");
  assert.ok(!source.includes("@fortawesome"), "must not import a global icon stylesheet");
});

test("the native permission request never fires on an already-decided status", () => {
  // The iOS hang: requestPermissions() on an already-granted/denied status never
  // resolves. The helper must branch on the current status and only request when
  // it is 'prompt'.
  const allSource = code(read("src/lib/jobsite-time/locationPermission.ts"));
  const interactiveStart = allSource.indexOf("export async function requestLocationPermissionInteractive");
  const wrapperStart = allSource.lastIndexOf(
    "export async function requestNativeLocationPermission",
    interactiveStart,
  );
  const source = allSource.slice(
    wrapperStart,
    interactiveStart,
  );
  assert.match(source, /if \(current === "granted"\) return "granted";/);
  assert.match(source, /if \(current === "denied"\) return "denied";/);
  const requestIdx = source.indexOf("requestNativeLocationPermissionFromPrompt");
  const denyGuardIdx = source.indexOf('if (current === "denied")');
  assert.ok(denyGuardIdx > -1 && denyGuardIdx < requestIdx, "must guard denied BEFORE requesting");
  assert.match(
    allSource.slice(
      allSource.indexOf("export async function requestNativeLocationPermissionFromPrompt"),
      allSource.indexOf("// Non-prompting check"),
    ),
    /geo\.requestPermissions\(\)/,
  );
});

test("device-credential enrollment is time-bounded (no un-timed fetch)", () => {
  const source = read("src/lib/attendance/deviceCredentialClient.ts");
  assert.match(source, /AbortController/, "enrollment fetch must be abortable");
  assert.match(source, /body: JSON\.stringify[\s\S]{0,100}signal,/, "fetch must carry the stage abort signal");
  assert.match(read("src/lib/jobsite-time/locationGate.ts"), /controller\.abort\(\)/, "stage timeout must abort the fetch");
});

test("the gate uses the exact required copy", () => {
  assert.equal(LOCATION_GATE_COPY.title, "Enable Location");
  assert.equal(LOCATION_GATE_COPY.body, "Groundwork Pro uses location for accuracy.");
  assert.equal(LOCATION_GATE_COPY.request, "Enable Location");
  assert.equal(LOCATION_GATE_COPY.retry, "Try Again");
  assert.equal(LOCATION_GATE_COPY.settings, "Open Settings");
});

test("approved header/body copy stays generic", () => {
  const strings = [
    LOCATION_GATE_COPY.title,
    LOCATION_GATE_COPY.body,
    LOCATION_GATE_COPY.deniedBody,
  ];
  for (const s of strings) {
    for (const forbidden of [/attendance/i, /clock/i, /jobsite/i, /arriv/i, /depart/i, /\btrack/i]) {
      assert.ok(!forbidden.test(s), `copy must not mention ${forbidden} — got: ${s}`);
    }
  }
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
    "Enable Location",
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
  // The enable flow runs through the bounded runLocationSetup state machine, and
  // a granted result dismisses via a plain onGranted() — no navigation/reload.
  assert.match(source, /runLocationSetup<DeviceCredentialPayload>\(\{/, "uses the bounded setup state machine");
  assert.match(source, /result\.status === 'granted'/, "acts on a granted result");
  assert.match(source, /onGranted\(\)/, "dismisses via onGranted");
});

test("the button can never be stranded on Requesting — busy always clears", () => {
  const source = code(gate());
  // busy drives the "Requesting…" label; it must be cleared in a finally so no
  // failure path leaves the button disabled forever.
  assert.match(
    source,
    /\} finally \{\s*setupInFlight\.current = false;\s*setBusy\(false\);/,
    "the lock and busy state are reset together in finally",
  );
  assert.match(source, /busy \? 'Requesting…' : label/, "label reverts once busy clears");
  // Failures surface a concise, recoverable error rather than a dead button.
  assert.match(source, /setErrorKind\(locationSetupErrorKind\(result\)\)/, "shows a concise error on failure");
});

test("a tap starts exactly one setup attempt and enters Requesting immediately", () => {
  const source = code(gate());
  assert.match(source, /onClick=\{handlePrimary\}/, "the primary tap must invoke the setup handler");
  assert.match(source, /if \(setupInFlight\.current\) return;/, "a synchronous lock must reject repeated taps");
  const lock = source.indexOf("setupInFlight.current = true");
  const busy = source.indexOf("setBusy(true)", lock);
  const setup = source.indexOf("performSetup(true)", busy);
  assert.ok(lock > -1 && busy > lock && setup > busy, "lock and Requesting state must be set before setup starts");
  assert.match(source, /setupInFlight\.current = false;\s*setBusy\(false\);/, "failure must restore a usable retry button");
});

test("a denied result cannot start a second bridge call that strands Requesting", () => {
  const source = code(gate());
  const deniedStart = source.indexOf("if (result.status === 'denied')");
  const denied = source.slice(deniedStart, source.indexOf("setErrorKind(locationSetupErrorKind(result))", deniedStart));
  assert.match(denied, /setPermission\('denied'\)/, "the native denial result is authoritative");
  assert.ok(!denied.includes("checkLocationPermission"), "must not perform an unbounded post-denial bridge check");
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
  assert.match(locationSettingsInstructions(true), /set Location to Always/);
  assert.match(locationSettingsInstructions(true), /Precise Location is on/);
  assert.match(locationSettingsInstructions(false), /site settings/);

  // The gate always shows instructions as a reliable fallback, even when the
  // WebView accepted the app-settings URL.
  assert.match(code(gate()), /setShowInstructions\(true\);\s*openAppLocationSettings\(\)/);
});

test("returning from Settings re-checks permission and lets the user in", () => {
  const source = code(gate());
  assert.match(source, /addEventListener\('focus'/, "re-check on foreground");
  assert.match(source, /visibilitychange/, "re-check on visibility change");
  // On return, a granted permission finishes (bounded) setup and then dismisses.
  assert.match(source, /performSetup\(false\)/, "the return check must use the same staged pipeline without prompting");
  assert.match(source, /if \(result\.status === 'granted'\) onGranted\(\)/, "dismisses once setup is complete");
});

test("focus events cannot race the tap-owned native setup", () => {
  const source = code(gate());
  const focusStart = source.indexOf("const onFocus = async () =>");
  const focus = source.slice(focusStart, source.indexOf("window.addEventListener('focus'", focusStart));
  assert.match(focus, /if \(setupInFlight\.current\) return;/);
  assert.match(focus, /setupInFlight\.current = true;/);
  assert.match(focus, /setupInFlight\.current = false;/);
});

// ── No header location prompt anywhere (Stage 2) ─────────────────────────────
test("there is no header/ribbon location prompt outside the single gate", () => {
  // The one and only permission experience is LocationRequiredGate. No header,
  // ribbon, or banner elsewhere may ask for or prompt location.
  for (const rel of [
    "app/page.tsx",
    "app/components/location/LocationBackgroundRuntime.tsx",
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
