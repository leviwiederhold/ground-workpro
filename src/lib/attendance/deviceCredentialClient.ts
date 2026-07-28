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

interface SecureAttendanceStorePlugin {
  setToken(opts: { token: string; expiresAt: string }): Promise<void>;
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
