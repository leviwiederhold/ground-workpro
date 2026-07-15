import test from "node:test";
import assert from "node:assert/strict";
import {
  generateRawNonce,
  sha256Hex,
  buildFullName,
  isUserCancelledError,
  readPendingInviteFromSearch,
  readPendingInviteState,
  resolvePostAuthRoute,
  writePendingInviteState,
} from "../../src/lib/auth/nativeOAuth.ts";

// ── Nonce + ID-token exchange correctness ────────────────────────────────────
test("generateRawNonce is url-safe and the requested length, and varies", () => {
  const a = generateRawNonce(32);
  const b = generateRawNonce(32);
  assert.equal(a.length, 32);
  assert.match(a, /^[A-Za-z0-9._-]+$/);
  assert.notEqual(a, b, "two nonces should not collide");
});

test("sha256Hex matches the known SHA-256 vector (Apple sends the hashed nonce)", async () => {
  // The nonce binding: we send SHA-256(rawNonce) to Apple and the raw nonce to
  // Supabase; both must derive the same hash.
  assert.equal(
    await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  );
  assert.equal(
    (await sha256Hex("groundwork")).length,
    64,
    "hex digest is always 64 chars"
  );
});

// ── Apple name persistence (only provided on first authorization) ────────────
test("buildFullName composes given + family, trims, and null-safes", () => {
  assert.equal(buildFullName("Ada", "Lovelace"), "Ada Lovelace");
  assert.equal(buildFullName("  Ada ", null), "Ada");
  assert.equal(buildFullName(null, "Lovelace"), "Lovelace");
  assert.equal(buildFullName(null, null), null);
  assert.equal(buildFullName("", "   "), null);
});

// ── Cancelled sign-in returns to a usable login screen ───────────────────────
test("isUserCancelledError detects Apple/Google cancellations", () => {
  assert.equal(isUserCancelledError({ code: "1001", message: "The operation was canceled." }), true);
  assert.equal(isUserCancelledError({ code: "12501" }), true);
  assert.equal(isUserCancelledError({ message: "The user canceled the sign-in flow." }), true);
  assert.equal(isUserCancelledError({ message: "popup_closed_by_user" }), true);
  assert.equal(isUserCancelledError(new Error("cancelled")), true);
});

test("isUserCancelledError does NOT swallow real errors", () => {
  assert.equal(isUserCancelledError({ message: "Network request failed" }), false);
  assert.equal(isUserCancelledError({ code: "invalid_token", message: "Invalid ID token" }), false);
  assert.equal(isUserCancelledError(null), false);
});

// ── Native invite state survives the native provider sheet ──────────────────
test("readPendingInviteFromSearch captures invite URL parameters", () => {
  assert.deepEqual(
    readPendingInviteFromSearch("?invite=1&token=abc123&role=operator&email=a%40b.com&employeeId=emp_1&companyName=Acme"),
    {
      invite: "1",
      token: "abc123",
      role: "operator",
      email: "a@b.com",
      employeeId: "emp_1",
      companyName: "Acme",
    }
  );
  assert.equal(readPendingInviteFromSearch("?token=abc123"), null);
});

test("pending invite state round-trips through storage and invalid JSON is cleared", () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  } as Storage;

  writePendingInviteState({ invite: "1", token: "abc123" }, storage);
  assert.deepEqual(readPendingInviteState(storage), { invite: "1", token: "abc123" });

  writePendingInviteState(null, storage);
  assert.equal(readPendingInviteState(storage), null);

  storage.setItem("groundwork:native-pending-invite", "{");
  assert.equal(readPendingInviteState(storage), null);
  assert.equal(storage.getItem("groundwork:native-pending-invite"), null);
});

// ── Post-auth routing is identical for email/Apple/Google, and invited users
//    never reach company bootstrap ──────────────────────────────────────────
test("resolvePostAuthRoute: invite always goes to invite acceptance (never bootstrap)", () => {
  assert.equal(resolvePostAuthRoute({ isInvite: true, hasWorkspace: false }), "accept-invite");
  // Even if the user somehow already has a workspace, an invite is still accepted
  // via the idempotent path — never routed to create a new company.
  assert.equal(resolvePostAuthRoute({ isInvite: true, hasWorkspace: true }), "accept-invite");
});

test("resolvePostAuthRoute: returning user with a workspace reaches the dashboard", () => {
  assert.equal(resolvePostAuthRoute({ isInvite: false, hasWorkspace: true }), "dashboard");
});

test("resolvePostAuthRoute: no invite + no workspace shows the no-workspace screen (no silent company creation)", () => {
  assert.equal(resolvePostAuthRoute({ isInvite: false, hasWorkspace: false }), "no-workspace");
});
