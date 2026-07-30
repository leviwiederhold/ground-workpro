/* eslint-disable @typescript-eslint/no-explicit-any */
// Client helper for enrolling / revoking a device attendance credential.
//
// The minted plaintext token is handed to a NATIVE secure store (iOS Keychain /
// Android Keystore) via the SecureAttendanceStore plugin — never kept in JS or
// Capacitor Preferences. When that plugin is absent (web, or a native build that
// hasn't bundled it), enrollment is a no-op: there is nowhere secure to keep the
// token, so we don't mint one. Only the non-secret deviceId is cached locally.

const DEVICE_ID_KEY = "attendance.deviceId.v1";

// The enrollment POST is over the network on a remote-URL native app, so it must
// be bounded — an un-timed fetch that stalls was one cause of the gate hanging
// on "Requesting…".
const ENROLL_FETCH_TIMEOUT_MS = 15_000;
const STATUS_FETCH_TIMEOUT_MS = 8_000;

interface SecureAttendanceStorePlugin {
  setToken(opts: { token: string; expiresAt: string }): Promise<void>;
  getToken(): Promise<{ hasToken?: boolean; expiresAt?: string }>;
  clear(): Promise<void>;
}

export type DeviceCredentialPayload = {
  token: string;
  expiresAt: string;
};

function secureStore(): SecureAttendanceStorePlugin | null {
  if (typeof window === "undefined") return null;
  const cap = (window as any).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  return (cap.Plugins?.SecureAttendanceStore as SecureAttendanceStorePlugin | undefined) ?? null;
}

/**
 * Mint a credential without writing it. The location gate keeps this network
 * transition separate from the Keychain write so a physical-device failure
 * identifies the real boundary instead of collapsing both into "enrollment".
 */
export async function requestDeviceCredential(
  platform?: string,
  signal?: AbortSignal,
): Promise<DeviceCredentialPayload> {
  const res = await fetch("/api/attendance/device-credential", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: getStableDeviceId(), platform }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`credential endpoint returned HTTP ${res.status}`);
  }

  const payload = await res.json();
  if (!payload?.token || !payload?.expiresAt) {
    throw new Error("credential endpoint returned an invalid payload");
  }
  return { token: String(payload.token), expiresAt: String(payload.expiresAt) };
}

/**
 * Persist a previously minted credential in the native secure store. Throws
 * when the native bridge is absent or the Keychain write fails so callers can
 * report SECURE_STORE_WRITE_FAILED rather than a generic setup failure.
 */
export async function writeDeviceCredentialToSecureStore(
  credential: DeviceCredentialPayload,
): Promise<void> {
  const store = secureStore();
  if (!store) throw new Error("SecureAttendanceStore native bridge unavailable");
  await store.setToken(credential);
}

/** A stable, non-secret per-install device id. Safe to keep in local storage. */
export function getStableDeviceId(): string {
  if (typeof window === "undefined") return "server";
  try {
    let id = window.localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = (crypto.randomUUID?.() ?? `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      window.localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return `dev-${Date.now()}`;
  }
}

/**
 * Server authority for whether this install's credential is still active.
 *
 * Keychain can only prove that bytes exist locally. Logout, admin revocation,
 * or a prior rotation can invalidate the corresponding server row without
 * changing the token's locally mirrored expiry date.
 */
export async function hasActiveDeviceCredential(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STATUS_FETCH_TIMEOUT_MS);
  try {
    const deviceId = encodeURIComponent(getStableDeviceId());
    const res = await fetch(
      `/api/attendance/device-credential?deviceId=${deviceId}`,
      { cache: "no-store", signal: controller.signal },
    );
    if (!res.ok) {
      throw new Error(`credential status endpoint returned HTTP ${res.status}`);
    }
    const payload = await res.json().catch(() => null);
    if (typeof payload?.active !== "boolean") {
      throw new Error("credential status endpoint returned an invalid payload");
    }
    return payload.active;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Enroll this device: mint a credential and store the token in the native
 * secure store. No-op (returns false) when no secure store is available — we
 * never mint a token we can't store securely.
 */
export async function enrollDeviceCredential(platform?: string): Promise<boolean> {
  const store = secureStore();
  if (!store) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENROLL_FETCH_TIMEOUT_MS);
  try {
    const credential = await requestDeviceCredential(platform, controller.signal);
    await store.setToken(credential);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

let ensureCredentialInFlight: Promise<boolean> | null = null;

/**
 * Keep the existing Keychain credential when it is still usable.
 *
 * The headless runtime previously minted on every render/focus cycle. One
 * physical-test day produced 65 server credential rows, with each mint revoking
 * the previous token. Concurrent mints could therefore write an already-revoked
 * token to the Keychain last. This single-flight check rotates only when the
 * secure store is empty, the token is close to expiry, or the server confirms
 * that the locally unexpired token was revoked.
 */
export async function ensureDeviceCredential(
  platform?: string,
  now: number = Date.now(),
): Promise<boolean> {
  if (ensureCredentialInFlight) return ensureCredentialInFlight;

  ensureCredentialInFlight = (async () => {
    const store = secureStore();
    if (!store) return false;
    try {
      const current = await store.getToken();
      const expiresAt = Date.parse(String(current?.expiresAt ?? ""));
      const usableForAtLeastOneDay =
        current?.hasToken === true &&
        Number.isFinite(expiresAt) &&
        expiresAt - now > 24 * 60 * 60 * 1000;
      if (usableForAtLeastOneDay) {
        try {
          if (await hasActiveDeviceCredential()) return true;
          await store.clear();
        } catch {
          // Preserve a potentially valid token on transient network failure.
          // Returning false keeps setup retryable without rotating blindly.
          return false;
        }
      }
    } catch {
      // A failed read is recoverable by one enrollment attempt below.
    }
    return enrollDeviceCredential(platform);
  })();

  try {
    return await ensureCredentialInFlight;
  } finally {
    ensureCredentialInFlight = null;
  }
}

/** Revoke this device's credential and clear the secured token (logout/opt-out). */
export async function revokeDeviceCredential(): Promise<void> {
  const deviceId = getStableDeviceId();
  await fetch("/api/attendance/device-credential", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId }),
  }).catch(() => {});
  try {
    await secureStore()?.clear();
  } catch {
    /* ignore */
  }
}
