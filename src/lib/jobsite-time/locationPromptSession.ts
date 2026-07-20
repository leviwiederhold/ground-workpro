// Session-scoped "Not now" memory for the location permission modal.
//
// Requirement: remember a dismissal for the CURRENT SESSION so the modal does
// not nag, but never suppress it permanently — the next time the user attempts
// a location-required action (clock in / clock out) they must be asked again.
//
// sessionStorage (not localStorage) gives exactly that lifetime: it clears when
// the tab/app session ends, so a dismissal can never become a permanent opt-out
// the user cannot recover from.
//
// Pure resolver + thin storage wrappers, so the decision logic is unit-testable
// without a DOM.

import type { LocationPermissionState } from "./locationPermission";

export const LOCATION_PROMPT_DISMISSED_KEY = "groundwork:location-prompt-dismissed";

export function markLocationPromptDismissed(storage: Storage | null | undefined): void {
  try {
    storage?.setItem(LOCATION_PROMPT_DISMISSED_KEY, "1");
  } catch {
    // Storage can be unavailable in locked-down WebViews — non-fatal.
  }
}

export function wasLocationPromptDismissed(storage: Storage | null | undefined): boolean {
  try {
    return storage?.getItem(LOCATION_PROMPT_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function clearLocationPromptDismissed(storage: Storage | null | undefined): void {
  try {
    storage?.removeItem(LOCATION_PROMPT_DISMISSED_KEY);
  } catch {
    // Non-fatal.
  }
}

export type LocationPromptDecision =
  /** Permission already granted — run the action, show nothing. */
  | "proceed"
  /** Ask: render the modal. */
  | "prompt"
  /** Permission is denied/unavailable — the action cannot run; explain why. */
  | "blocked";

/**
 * Decide what should happen when the user attempts a location-required action.
 *
 * `dismissed` deliberately does NOT suppress the prompt here. A "Not now" only
 * stops the modal appearing on its own; once the user actively tries to clock in
 * or out, they are asked again — otherwise the action would silently fail with
 * no way to recover within the session.
 */
export function resolveLocationPromptDecision(params: {
  permission: LocationPermissionState | "checking";
}): LocationPromptDecision {
  const { permission } = params;
  if (permission === "granted") return "proceed";
  if (permission === "denied" || permission === "unavailable") return "blocked";
  return "prompt"; // "prompt" | "checking"
}

/**
 * Whether a passive (non-user-initiated) surface may show the prompt.
 *
 * Used to keep the modal off the dashboard: it may only appear when the user
 * initiated a location-required action, or — if a surface ever opts into
 * passive prompting — when they have not already said "Not now" this session.
 */
export function shouldShowPassivePrompt(params: {
  permission: LocationPermissionState | "checking";
  dismissedThisSession: boolean;
  userInitiated: boolean;
}): boolean {
  if (params.permission === "granted") return false;
  if (params.userInitiated) return true;
  return !params.dismissedThisSession;
}
