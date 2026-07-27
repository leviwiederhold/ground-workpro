// Client-side read of the cached navigation state.
//
// app/page.tsx persists the resolved nav (including the UI role) to localStorage
// so the shell can render immediately on the next load without waiting for the
// nav fetch. The location gate reuses that already-hydrated role to decide who
// participates in automatic attendance — reading it here is a localStorage read,
// NOT another blocking bootstrap fetch.

/** Must match the key app/page.tsx writes the nav cache under. */
export const NAV_CACHE_KEY = "groundwork.nav-cache";

/**
 * The cached UI role (`executive`, `operations`, `foreman`, `mechanic`, `field`,
 * `operator`), or null when nothing is cached yet (e.g. a first-ever login) or
 * storage is unavailable. Never throws.
 */
export function readCachedUiRole(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(NAV_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed?.role === "string" ? parsed.role : null;
  } catch {
    return null;
  }
}
