import assert from "node:assert/strict";
import test from "node:test";

import { ensureDeviceCredential } from "../../src/lib/attendance/deviceCredentialClient.ts";

function installNativeWindow(store: {
  getToken(): Promise<{
    hasToken?: boolean;
    expiresAt?: string;
    hasRefreshToken?: boolean;
    refreshExpiresAt?: string;
  }>;
  setToken(value: {
    token: string;
    expiresAt: string;
    refreshToken?: string;
    refreshExpiresAt?: string;
    deviceId?: string;
  }): Promise<void>;
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

test("a healthy Keychain credential is reused after server validation", async () => {
  let writes = 0;
  const restore = installNativeWindow({
    getToken: async () => ({
      hasToken: true,
      hasRefreshToken: true,
      expiresAt: "2026-08-15T00:00:00.000Z",
    }),
    setToken: async () => {
      writes += 1;
    },
    clear: async () => {},
  });
  let fetches = 0;
  globalThis.fetch = (async (input, init) => {
    fetches += 1;
    assert.match(String(input), /\/api\/attendance\/device-credential\?deviceId=/);
    assert.equal(init?.method, undefined);
    return new Response(JSON.stringify({ active: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const ready = await ensureDeviceCredential(
      "ios",
      Date.parse("2026-07-29T12:00:00.000Z"),
    );
    assert.equal(ready, true);
    assert.equal(fetches, 1);
    assert.equal(writes, 0);
  } finally {
    restore();
  }
});

test("a revoked but locally unexpired token is cleared and re-enrolled", async () => {
  let writes = 0;
  let clears = 0;
  const restore = installNativeWindow({
    getToken: async () => ({
      hasToken: true,
      hasRefreshToken: true,
      expiresAt: "2026-08-15T00:00:00.000Z",
    }),
    setToken: async () => {
      writes += 1;
    },
    clear: async () => {
      clears += 1;
    },
  });
  let fetches = 0;
  globalThis.fetch = (async (input) => {
    fetches += 1;
    if (String(input).includes("?deviceId=")) {
      return new Response(JSON.stringify({ active: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({
        token: "replacement-token",
        expiresAt: "2026-08-29T00:00:00.000Z",
        refreshToken: "replacement-refresh-token",
        refreshExpiresAt: "2027-08-29T00:00:00.000Z",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    assert.equal(
      await ensureDeviceCredential(
        "ios",
        Date.parse("2026-07-29T12:00:00.000Z"),
      ),
      true,
    );
    assert.equal(fetches, 2);
    assert.equal(clears, 1);
    assert.equal(writes, 1);
  } finally {
    restore();
  }
});

test("a failed server validation preserves the Keychain token and stays retryable", async () => {
  let clears = 0;
  let writes = 0;
  const restore = installNativeWindow({
    getToken: async () => ({
      hasToken: true,
      hasRefreshToken: true,
      expiresAt: "2026-08-15T00:00:00.000Z",
    }),
    setToken: async () => {
      writes += 1;
    },
    clear: async () => {
      clears += 1;
    },
  });
  globalThis.fetch = (async () => new Response("down", { status: 503 })) as typeof fetch;

  try {
    assert.equal(
      await ensureDeviceCredential(
        "ios",
        Date.parse("2026-07-29T12:00:00.000Z"),
      ),
      false,
    );
    assert.equal(clears, 0);
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
        refreshToken: "secret-refresh-token",
        refreshExpiresAt: "2027-08-15T00:00:00.000Z",
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

test("a legacy access token without a refresh secret is upgraded once", async () => {
  let writes = 0;
  const restore = installNativeWindow({
    getToken: async () => ({
      hasToken: true,
      hasRefreshToken: false,
      expiresAt: "2026-08-15T00:00:00.000Z",
    }),
    setToken: async (value) => {
      writes += 1;
      assert.equal(value.deviceId?.length ? true : false, true);
      assert.equal(value.refreshToken, "new-refresh-token");
    },
    clear: async () => {},
  });
  let fetches = 0;
  globalThis.fetch = (async () => {
    fetches += 1;
    return new Response(
      JSON.stringify({
        token: "new-access-token",
        expiresAt: "2026-08-29T00:00:00.000Z",
        refreshToken: "new-refresh-token",
        refreshExpiresAt: "2027-08-29T00:00:00.000Z",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    assert.equal(
      await ensureDeviceCredential("ios", Date.parse("2026-07-29T12:00:00.000Z")),
      true,
    );
    assert.equal(fetches, 1);
    assert.equal(writes, 1);
  } finally {
    restore();
  }
});
