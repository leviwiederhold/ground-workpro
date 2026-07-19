// Shared login logic used by BOTH the web route (/login) and the native route
// (/native/login).
//
// Extracted so the native route can reuse invite acceptance, workspace
// membership checks, and post-auth routing without duplicating them. Duplicating
// this is how you end up with two subtly different invite paths and, eventually,
// duplicate workspaces or memberships.

import {
  readPendingInviteFromSearch,
  readPendingInviteState,
  writePendingInviteState,
  type PendingInviteState,
  // Relative, not "@/…": these modules are imported directly by the node test
  // runner, which does not resolve the TypeScript path alias.
} from "./nativeOAuth.ts";

// The two login entry points. The ROUTE is now the authoritative distinction
// between native and web — not a runtime flag.
export const WEB_LOGIN_ROUTE = "/login";
export const NATIVE_LOGIN_ROUTE = "/native/login";

/**
 * Where a sign-out should land.
 *
 * Native sessions return to the native route so the app never drops the user on
 * the website's login screen; the web returns to /login. Based on the current
 * pathname, so it needs no runtime detection.
 */
export function resolveSignOutRoute(pathname: string | null | undefined): string {
  return String(pathname ?? "").startsWith("/native/") ? NATIVE_LOGIN_ROUTE : WEB_LOGIN_ROUTE;
}

/** Invite state from the URL, falling back to whatever survived a provider sheet. */
export function getPendingInvite(search: string, storage: Storage | null | undefined): PendingInviteState | null {
  return readPendingInviteFromSearch(search) ?? readPendingInviteState(storage);
}

export type TenantContextOptions = {
  search: string;
  storage: Storage | null | undefined;
  /** Clear persisted invite state after a successful accept (native sheets). */
  clearStoredInviteOnAccept: boolean;
};

/**
 * Accept a pending invite, or bootstrap the workspace.
 *
 * Identical semantics to the original web implementation: invite acceptance is
 * authoritative and throws on failure, while bootstrap is idempotent and FAILS
 * OPEN so a slow bootstrap can never pin the user on "Signing in…".
 */
export async function ensureTenantContext(options: TenantContextOptions): Promise<void> {
  const params = new URLSearchParams(options.search);
  const storedInvite = readPendingInviteState(options.storage);

  const invite = params.get("invite") === "1" || storedInvite?.invite === "1";
  const inviteRole = params.get("role") || storedInvite?.role || undefined;
  const inviteEmail = params.get("email") || storedInvite?.email || undefined;
  const inviteEmployeeId = params.get("employeeId") || storedInvite?.employeeId || undefined;
  const inviteToken = params.get("token") || storedInvite?.token || undefined;
  const stripeSessionId = params.get("session_id") || undefined;

  if (invite) {
    const accept = await fetch("/api/invite/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: inviteRole, email: inviteEmail, employeeId: inviteEmployeeId, token: inviteToken }),
    });
    if (!accept.ok) {
      const payload = await accept.json().catch(() => ({}));
      throw new Error(payload?.error || "Failed to accept invite");
    }
    if (options.clearStoredInviteOnAccept) {
      writePendingInviteState(null, options.storage);
    }
    return;
  }

  try {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 8000);
    try {
      await fetch("/api/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stripeSessionId }),
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timeoutId);
    }
  } catch {
    // Timeout or network failure — proceed; the app shell finishes setup.
  }
}

/**
 * Whether the signed-in user belongs to a workspace.
 *
 * Fails OPEN on server/network errors: locking an existing user out because of a
 * transient failure is far worse than briefly letting them through to a shell
 * that will re-check.
 */
export async function checkWorkspaceMembership(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/has-workspace");
    if (res.status === 401) return false;
    if (!res.ok) return true;
    const payload = await res.json().catch(() => ({}));
    return Boolean(payload?.hasWorkspace);
  } catch {
    return true;
  }
}

export type PostAuthDestination = "dashboard" | "no-workspace";

/**
 * Decide where to send the user after a successful native sign-in.
 *
 * An invited user ALWAYS goes through invite acceptance and therefore never
 * through company bootstrap — the safeguard that stops an invited employee from
 * creating a second workspace.
 */
export async function resolveNativePostAuthDestination(options: {
  search: string;
  storage: Storage | null | undefined;
}): Promise<PostAuthDestination> {
  const pendingInvite = getPendingInvite(options.search, options.storage);

  if (pendingInvite) {
    await ensureTenantContext({
      search: options.search,
      storage: options.storage,
      clearStoredInviteOnAccept: true,
    });
    writePendingInviteState(null, options.storage);
    return "dashboard";
  }

  return (await checkWorkspaceMembership()) ? "dashboard" : "no-workspace";
}
