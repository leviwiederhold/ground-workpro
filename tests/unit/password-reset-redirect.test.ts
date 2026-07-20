import test from "node:test";
import assert from "node:assert/strict";
import {
  recoveryRedirectUrl,
  RESET_PASSWORD_PATH,
  RECOVERY_LINK_ERROR,
} from "../../src/lib/auth/passwordReset.ts";

// The recovery email must send users through the server auth callback (so the
// recovery session is restored via Set-Cookie), not straight to the reset page.
// A regression here — pointing `redirectTo` back at /reset-password or /login —
// is exactly what broke the flow before, so pin the shape of the URL.

test("recoveryRedirectUrl routes through /auth/callback with a next hint", () => {
  const url = new URL(recoveryRedirectUrl("https://groundwork-pro.com"));
  assert.equal(url.origin, "https://groundwork-pro.com");
  assert.equal(url.pathname, "/auth/callback");
  assert.equal(url.searchParams.get("next"), RESET_PASSWORD_PATH);
  assert.equal(url.searchParams.get("type"), "recovery");
});

test("recoveryRedirectUrl preserves a localhost origin for local development", () => {
  const url = new URL(recoveryRedirectUrl("http://localhost:3000"));
  assert.equal(url.origin, "http://localhost:3000");
  assert.equal(url.pathname, "/auth/callback");
  assert.equal(url.searchParams.get("next"), "/reset-password");
});

test("recovery constants stay in sync with the callback/reset contract", () => {
  assert.equal(RESET_PASSWORD_PATH, "/reset-password");
  assert.equal(RECOVERY_LINK_ERROR, "recovery_link_invalid");
});
