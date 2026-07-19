import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decodeIdTokenPayload, readIdTokenNonce } from "../../src/lib/auth/nativeOAuth.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = () => readFileSync(join(repoRoot, "src/lib/auth/nativeOAuth.ts"), "utf8");

function makeIdToken(payload: Record<string, unknown>): string {
  const b64 = (value: object) =>
    Buffer.from(JSON.stringify(value))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${b64({ alg: "RS256", typ: "JWT" })}.${b64(payload)}.signature-not-verified`;
}

// ── Reading the nonce claim ──────────────────────────────────────────────────
test("readIdTokenNonce returns the claim when present", () => {
  assert.equal(readIdTokenNonce(makeIdToken({ sub: "123", nonce: "abc123" })), "abc123");
});

test("readIdTokenNonce returns null when the claim is absent or blank", () => {
  assert.equal(readIdTokenNonce(makeIdToken({ sub: "123" })), null);
  assert.equal(readIdTokenNonce(makeIdToken({ sub: "123", nonce: "" })), null);
  assert.equal(readIdTokenNonce(makeIdToken({ sub: "123", nonce: "   " })), null);
  // Non-string claim must not be coerced.
  assert.equal(readIdTokenNonce(makeIdToken({ sub: "123", nonce: 42 })), null);
});

test("readIdTokenNonce never throws on malformed input", () => {
  for (const bad of ["", "not-a-jwt", "a.b", "a..c", "...", "%%%.%%%.%%%"]) {
    assert.doesNotThrow(() => readIdTokenNonce(bad), `input ${JSON.stringify(bad)} must not throw`);
  }
  assert.equal(readIdTokenNonce("not-a-jwt"), null);
});

test("decodeIdTokenPayload handles UTF-8 claims", () => {
  const payload = decodeIdTokenPayload(makeIdToken({ name: "Renée Ångström", nonce: "n1" }));
  assert.equal(payload?.name, "Renée Ångström");
  assert.equal(payload?.nonce, "n1");
});

// ── The symmetry rule ────────────────────────────────────────────────────────
// Supabase rejects "nonce passed but not in token" AND "in token but not
// passed". These pin the rule that makes both impossible.

test("Google sends NO nonce to Supabase when the ID token has no nonce claim", () => {
  const code = source();
  const google = code.slice(code.indexOf("export async function signInWithGoogleNative"));

  // The nonce is derived from the token, not invented.
  assert.match(google, /const tokenNonce = readIdTokenNonce\(idToken\)/);

  // Absent claim -> the payload has no nonce key at all.
  assert.match(
    google,
    /:\s*\{ provider: "google", token: idToken \}/,
    "with no claim, Supabase must receive only provider and token",
  );
  // Present claim -> the same value goes back.
  assert.match(
    google,
    /\{ provider: "google", token: idToken, nonce: tokenNonce \}/,
    "with a claim, Supabase must receive that exact nonce",
  );
});

test("no nonce is generated for, or passed to, the Google login request", () => {
  const code = source();
  const google = code.slice(
    code.indexOf("export async function signInWithGoogleNative"),
    code.indexOf("const tokenNonce"),
  );

  assert.ok(!google.includes("generateRawNonce"), "Google must not generate a nonce");
  assert.ok(!google.includes("sha256Hex"), "Google must not hash a nonce");

  // The SocialLogin.login options for Google carry scopes only.
  const loginCall = google.slice(google.indexOf("SocialLogin.login"));
  const optionsBlock = loginCall.slice(0, loginCall.indexOf("});"));
  assert.ok(!optionsBlock.includes("nonce"), "no nonce may be sent to the Google plugin");
  assert.match(optionsBlock, /scopes: \["email", "profile"\]/, "scopes must be unchanged");
});

// ── Apple must be untouched ──────────────────────────────────────────────────
test("Apple still hashes the nonce for the provider and sends the RAW nonce to Supabase", () => {
  const code = source();
  const apple = code.slice(
    code.indexOf("export async function signInWithAppleNative"),
    code.indexOf("export async function signInWithGoogleNative"),
  );

  assert.match(apple, /const rawNonce = generateRawNonce\(\)/);
  assert.match(apple, /const hashedNonce = await sha256Hex\(rawNonce\)/);
  // Hashed goes to Apple...
  assert.match(apple, /nonce: hashedNonce/, "Apple's request must carry the hashed nonce");
  // ...raw goes to Supabase.
  assert.match(
    apple,
    /signInWithIdToken\(\{[\s\S]{0,120}provider: "apple",[\s\S]{0,120}nonce: rawNonce,/,
    "Supabase must receive Apple's RAW nonce",
  );

  // Apple must not have picked up the token-mirroring rule.
  assert.ok(!apple.includes("readIdTokenNonce"), "the Apple flow must be left alone");
});

test("the Apple and Google flows stay isolated", () => {
  const code = source();
  const appleStart = code.indexOf("export async function signInWithAppleNative");
  const googleStart = code.indexOf("export async function signInWithGoogleNative");
  assert.ok(appleStart > 0 && googleStart > appleStart, "both flows must exist, Apple first");

  const apple = code.slice(appleStart, googleStart);
  const google = code.slice(googleStart);

  // Neither calls into the other's provider.
  assert.ok(!apple.includes('provider: "google"'), "the Apple flow must not touch Google");
  assert.ok(!google.includes('provider: "apple"'), "the Google flow must not touch Apple");

  // Each performs exactly one exchange. Matched on the call itself, since the
  // surrounding comments also mention signInWithIdToken.
  assert.equal((apple.match(/supabase\.auth\.signInWithIdToken\(/g) ?? []).length, 1);
  assert.equal((google.match(/supabase\.auth\.signInWithIdToken\(/g) ?? []).length, 1);
});

// ── Dev-only logging, no token leakage ───────────────────────────────────────
test("the nonce-claim probe logs presence only, in development only", () => {
  const code = source();
  const google = code.slice(code.indexOf("export async function signInWithGoogleNative"));

  assert.match(google, /process\.env\.NODE_ENV !== "production"/, "the probe must be development-only");
  assert.match(google, /nonce claim present:", tokenNonce !== null/, "only presence may be logged");

  // The token itself, and the nonce value, must never be logged.
  const logLines = (google.match(/console\.log\([^)]*\)/g) ?? []).join("\n");
  assert.ok(!/idToken\b/.test(logLines), "the ID token must never be logged");
  assert.ok(!/,\s*tokenNonce\s*\)/.test(logLines), "the nonce value must never be logged");
});
