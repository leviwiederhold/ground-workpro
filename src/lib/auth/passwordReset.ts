// Shared helpers for the password recovery / reset flow.
//
// Recovery emails route through the server auth callback (not directly to the
// reset page) so the recovery session is established via Set-Cookie during the
// server-side code exchange before the user ever lands on /reset-password. The
// `next` param tells the callback where to send the user afterward, and `type`
// marks the exchange as a recovery so failures surface a recovery-specific
// error on the reset page instead of bouncing to the generic login error.

export const RESET_PASSWORD_PATH = "/reset-password";

/** Query-param value the callback sets on the reset page when a link is bad. */
export const RECOVERY_LINK_ERROR = "recovery_link_invalid";

/**
 * Build the `redirectTo` URL passed to `supabase.auth.resetPasswordForEmail`.
 * Always routes through `/auth/callback` so the recovery session is restored
 * server-side. Callers pass `window.location.origin`.
 */
export function recoveryRedirectUrl(origin: string): string {
  const url = new URL("/auth/callback", origin);
  url.searchParams.set("next", RESET_PASSWORD_PATH);
  url.searchParams.set("type", "recovery");
  return url.toString();
}
