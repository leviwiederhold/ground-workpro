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

function secureStore(): SecureAttendanceStorePlugin | null {
  if (typeof window === "undefined") return null;
  const cap = (window as any).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  return (cap.Plugins?.SecureAttendanceStore as SecureAttendanceStorePlugin | undefined) ?? null;
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

  const deviceId = getStableDeviceId();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENROLL_FETCH_TIMEOUT_MS);
  const res = await fetch("/api/attendance/device-credential", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId, platform }),
    signal: controller.signal,
  })
    .catch(() => null)
    .finally(() => clearTimeout(timer));
  if (!res || !res.ok) return false;

  const payload = await res.json().catch(() => null);
  if (!payload?.token || !payload?.expiresAt) return false;

  try {
    await store.setToken({ token: payload.token, expiresAt: payload.expiresAt });
    return true;
  } catch {
    return false;
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
