import assert from "node:assert/strict";
import test from "node:test";

import { ensureDeviceCredential } from "../../src/lib/attendance/deviceCredentialClient.ts";

function installNativeWindow(store: {
  getToken(): Promise<{ hasToken?: boolean; expiresAt?: string }>;
  setToken(value: { token: string; expiresAt: string }): Promise<void>;
  clear(): Promise<void>;
}) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalFetch = globalThis.fetch;
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      Capacitor: {
        isNativePlatform: () => true,
        Plugins: { SecureAttendanceStore: store },
      },
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    },
  });

  return () => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    globalThis.fetch = originalFetch;
  };
}

test("a healthy Keychain credential is reused without minting another server row", async () => {
  let writes = 0;
  const restore = installNativeWindow({
    getToken: async () => ({
      hasToken: true,
      expiresAt: "2026-08-15T00:00:00.000Z",
    }),
    setToken: async () => {
      writes += 1;
    },
    clear: async () => {},
  });
  let fetches = 0;
  globalThis.fetch = (async () => {
    fetches += 1;
    throw new Error("must not enroll");
  }) as typeof fetch;

  try {
    const ready = await ensureDeviceCredential(
      "ios",
      Date.parse("2026-07-29T12:00:00.000Z"),
    );
    assert.equal(ready, true);
    assert.equal(fetches, 0);
    assert.equal(writes, 0);
  } finally {
    restore();
  }
});

test("concurrent credential checks collapse to one enrollment and one Keychain write", async () => {
  let writes = 0;
  const restore = installNativeWindow({
    getToken: async () => ({ hasToken: false }),
    setToken: async () => {
      writes += 1;
    },
    clear: async () => {},
  });
  let fetches = 0;
  globalThis.fetch = (async () => {
    fetches += 1;
    return new Response(
      JSON.stringify({
        token: "secret-token",
        expiresAt: "2026-08-15T00:00:00.000Z",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const [first, second] = await Promise.all([
      ensureDeviceCredential("ios", Date.parse("2026-07-29T12:00:00.000Z")),
      ensureDeviceCredential("ios", Date.parse("2026-07-29T12:00:00.000Z")),
    ]);
    assert.deepEqual([first, second], [true, true]);
    assert.equal(fetches, 1);
    assert.equal(writes, 1);
  } finally {
    restore();
  }
});
