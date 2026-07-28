/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";
import {
  mapCapacitorPermission,
  mapGeolocationError,
  resolveLocationGateView,
  checkLocationPermission,
  requestNativeLocationPermission,
  requestLocationPermissionInteractive,
  type NativeGeolocationPlugin,
} from "../../src/lib/jobsite-time/locationPermission.ts";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Bug fixed here: tapping "Enable/Allow location" did nothing because the old
// helper only *queried* the Permissions API (never surfaced a dialog). These
// tests lock in the four required outcomes end to end (web path — no Capacitor,
// since `window` is undefined in Node so getCapacitor() returns null).

type NavShape = {
  geolocation?: {
    getCurrentPosition?: (
      ok: (pos: any) => void,
      err: (e: any) => void,
      opts?: any
    ) => void;
  };
  permissions?: { query?: (d: any) => Promise<{ state: string }> };
};

test("the required gate bundles Geolocation instead of loading it during the tap", () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src/lib/jobsite-time/locationPermission.ts"),
    "utf8",
  );
  assert.match(source, /import \{ Geolocation \} from "@capacitor\/geolocation";/);
  assert.ok(
    !source.includes('import("@capacitor/geolocation")'),
    "a physical iPhone must not wait on a dynamic Geolocation chunk before checkPermissions",
  );
});

// Node 22 exposes a built-in read-only `navigator` getter, so assignment throws.
// Override it via a configurable property descriptor and restore afterward.
function withNavigator(nav: NavShape | undefined, fn: () => Promise<void>) {
  const g = globalThis as any;
  const prevDesc = Object.getOwnPropertyDescriptor(g, "navigator");
  Object.defineProperty(g, "navigator", { value: nav, configurable: true, writable: true });
  return fn().finally(() => {
    if (prevDesc) Object.defineProperty(g, "navigator", prevDesc);
    else delete g.navigator;
  });
}

// --- pure mappers ----------------------------------------------------------
test("mapCapacitorPermission maps native statuses", () => {
  assert.equal(mapCapacitorPermission({ location: "granted" }), "granted");
  assert.equal(mapCapacitorPermission({ location: "denied" }), "denied");
  assert.equal(mapCapacitorPermission({ location: "prompt" }), "prompt");
  assert.equal(mapCapacitorPermission({ coarseLocation: "granted" }), "granted");
  assert.equal(mapCapacitorPermission(null), "prompt");
});

test("mapCapacitorPermission honors an Android Approximate (coarse-only) grant", () => {
  // fine denied/prompt but coarse granted → allowed through (we use low accuracy)
  assert.equal(mapCapacitorPermission({ location: "denied", coarseLocation: "granted" }), "granted");
  assert.equal(mapCapacitorPermission({ location: "prompt", coarseLocation: "granted" }), "granted");
  // still promptable if either alias can prompt
  assert.equal(mapCapacitorPermission({ location: "denied", coarseLocation: "prompt" }), "prompt");
  // only blocked when both are denied
  assert.equal(mapCapacitorPermission({ location: "denied", coarseLocation: "denied" }), "denied");
});

test("mapGeolocationError: only PERMISSION_DENIED(1) is denied, rest unavailable", () => {
  assert.equal(mapGeolocationError({ code: 1 }), "denied"); // PERMISSION_DENIED
  assert.equal(mapGeolocationError({ code: 2 }), "unavailable"); // POSITION_UNAVAILABLE
  assert.equal(mapGeolocationError({ code: 3 }), "unavailable"); // TIMEOUT
  assert.equal(mapGeolocationError(null), "unavailable");
});

test("resolveLocationGateView maps each state to a UI", () => {
  assert.equal(resolveLocationGateView("checking"), "checking");
  assert.equal(resolveLocationGateView("granted"), "clock-in");
  assert.equal(resolveLocationGateView("prompt"), "pre-permission");
  assert.equal(resolveLocationGateView("denied"), "blocked");
  assert.equal(resolveLocationGateView("unavailable"), "unavailable");
});

function nativePlugin(overrides: Partial<NativeGeolocationPlugin> = {}): NativeGeolocationPlugin {
  return {
    checkPermissions: async () => ({ location: "prompt", coarseLocation: "prompt" }),
    requestPermissions: async () => ({ location: "granted", coarseLocation: "granted" }),
    getCurrentPosition: async () => ({ coords: { latitude: 39.3, longitude: -84.3 } }),
    ...overrides,
  };
}

// --- real Capacitor/iOS bridge behavior ------------------------------------
test("first-time iOS permission request checks once, prompts once, and grants", async () => {
  let checks = 0;
  let requests = 0;
  const plugin = nativePlugin({
    checkPermissions: async () => {
      checks += 1;
      return { location: "prompt", coarseLocation: "prompt" };
    },
    requestPermissions: async () => {
      requests += 1;
      return { location: "granted", coarseLocation: "granted" };
    },
  });

  assert.equal(await requestNativeLocationPermission(plugin), "granted");
  assert.equal(checks, 1);
  assert.equal(requests, 1);
});

test("already-granted iOS permission skips the system request", async () => {
  let requests = 0;
  const plugin = nativePlugin({
    checkPermissions: async () => ({ location: "granted", coarseLocation: "granted" }),
    requestPermissions: async () => {
      requests += 1;
      return { location: "granted", coarseLocation: "granted" };
    },
  });

  assert.equal(await requestNativeLocationPermission(plugin), "granted");
  assert.equal(requests, 0, "must not ask iOS again after permission is decided");
});

test("denied iOS permission returns denied without calling requestPermissions", async () => {
  let requests = 0;
  const plugin = nativePlugin({
    checkPermissions: async () => ({ location: "denied", coarseLocation: "denied" }),
    requestPermissions: async () => {
      requests += 1;
      return { location: "denied", coarseLocation: "denied" };
    },
  });

  assert.equal(await requestNativeLocationPermission(plugin), "denied");
  assert.equal(requests, 0, "a denied iOS status must go to Settings, not another prompt");
});

test("native permission call failure is terminal and retryable", async () => {
  const plugin = nativePlugin({
    requestPermissions: async () => {
      throw new Error("bridge rejected");
    },
  });
  assert.equal(await requestNativeLocationPermission(plugin), "unavailable");
});

test("native bridge/plugin unavailable is terminal and never uses browser geolocation", async () => {
  assert.equal(await requestNativeLocationPermission(null), "unavailable");
});

// --- case 1: already granted → skips the permission screen -----------------
test("already granted → check resolves granted (gate shows clock-in, no prompt)", async () => {
  await withNavigator(
    {
      geolocation: { getCurrentPosition: () => assert.fail("must not prompt when already granted") },
      permissions: { query: async () => ({ state: "granted" }) },
    },
    async () => {
      assert.equal(await checkLocationPermission(), "granted");
      assert.equal(resolveLocationGateView(await checkLocationPermission()), "clock-in");
      // interactive must also short-circuit without calling getCurrentPosition
      assert.equal(await requestLocationPermissionInteractive(), "granted");
    }
  );
});

// --- case 2: prompt + allow → advances to clock-in -------------------------
test("prompt + allow → interactive triggers getCurrentPosition and returns granted", async () => {
  let prompted = false;
  await withNavigator(
    {
      geolocation: {
        getCurrentPosition: (ok) => {
          prompted = true;
          ok({ coords: { latitude: 40.1, longitude: -83.0, accuracy: 12 } });
        },
      },
      permissions: { query: async () => ({ state: "prompt" }) },
    },
    async () => {
      const result = await requestLocationPermissionInteractive();
      assert.equal(result, "granted");
      assert.equal(prompted, true, "the real geolocation prompt must be fired from the tap");
      assert.equal(resolveLocationGateView(result), "clock-in");
    }
  );
});

// --- case 3: denied → blocked instructions ---------------------------------
test("denied → interactive returns denied → gate shows blocked", async () => {
  await withNavigator(
    {
      geolocation: {
        getCurrentPosition: (_ok, err) => err({ code: 1, message: "User denied Geolocation" }),
      },
      // no permissions API answer → falls through to the prompt, which denies
      permissions: { query: async () => ({ state: "prompt" }) },
    },
    async () => {
      const result = await requestLocationPermissionInteractive();
      assert.equal(result, "denied");
      assert.equal(resolveLocationGateView(result), "blocked");
    }
  );
});

// --- case 4: unsupported geolocation → specific error ----------------------
test("unsupported geolocation → unavailable → gate shows unavailable error", async () => {
  await withNavigator({ /* no geolocation, no permissions */ }, async () => {
    assert.equal(await checkLocationPermission(), "unavailable");
    assert.equal(await requestLocationPermissionInteractive(), "unavailable");
    assert.equal(resolveLocationGateView("unavailable"), "unavailable");
  });
  // also when navigator itself is absent
  await withNavigator(undefined, async () => {
    assert.equal(await requestLocationPermissionInteractive(), "unavailable");
  });
});
