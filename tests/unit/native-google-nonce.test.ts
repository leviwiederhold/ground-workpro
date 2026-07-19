import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  decodeIdTokenPayload,
  generateRawNonce,
  readIdTokenNonce,
  sha256Hex,
} from "../../src/lib/auth/nativeOAuth.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = () => readFileSync(join(repoRoot, "src/lib/auth/nativeOAuth.ts"), "utf8");

const googleFlow = () => {
  const code = source();
  return code.slice(code.indexOf("export async function signInWithGoogleNative"));
};
const appleFlow = () => {
  const code = source();
  return code.slice(
    code.indexOf("export async function signInWithAppleNative"),
    code.indexOf("export async function signInWithGoogleNative"),
  );
};

function makeIdToken(payload: Record<string, unknown>): string {
  const b64 = (value: object) =>
    Buffer.from(JSON.stringify(value))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${b64({ alg: "RS256", typ: "JWT" })}.${b64(payload)}.signature-not-verified`;
}

// ── The nonce pair itself ────────────────────────────────────────────────────
test("hashing produces a value that differs from the raw nonce", async () => {
  const rawNonce = generateRawNonce();
  const hashedNonce = await sha256Hex(rawNonce);

  assert.notEqual(hashedNonce, rawNonce, "the hashed nonce must never equal the raw nonce");
  assert.match(hashedNonce, /^[0-9a-f]{64}$/, "must be lowercase hex SHA-256, as Supabase documents");

  // Deterministic, so Supabase's re-hash of the raw value reproduces the claim.
  assert.equal(await sha256Hex(rawNonce), hashedNonce);
});

// ── Google follows the documented contract ───────────────────────────────────
test("Google receives the HASHED nonce in its login request", () => {
  const google = googleFlow();

  assert.match(google, /const rawNonce = generateRawNonce\(\)/, "a fresh raw nonce must be generated");
  assert.match(google, /const hashedNonce = await sha256Hex\(rawNonce\)/, "it must be SHA-256 hashed");

  const loginCall = google.slice(google.indexOf("SocialLogin.login"));
  const optionsBlock = loginCall.slice(0, loginCall.indexOf("});"));
  assert.match(optionsBlock, /nonce: hashedNonce/, "the provider must receive the HASHED nonce");
  assert.ok(!optionsBlock.includes("nonce: rawNonce"), "the provider must never receive the RAW nonce");
  assert.match(optionsBlock, /scopes: \["email", "profile"\]/, "scopes must be unchanged");
});

test("Supabase receives the RAW nonce for Google", () => {
  const google = googleFlow();

  assert.match(
    google,
    /supabase\.auth\.signInWithIdToken\(\{[\s\S]{0,400}provider: "google",[\s\S]{0,400}nonce: rawNonce,/,
    "Supabase must receive the RAW nonce",
  );
  assert.ok(
    !/signInWithIdToken\([\s\S]{0,400}nonce: hashedNonce/.test(google),
    "Supabase must never receive the hashed nonce",
  );
});

test("one generated pair is used for a single login attempt", () => {
  const google = googleFlow();

  // Exactly one generation, one hash — not regenerated between request and exchange.
  assert.equal((google.match(/generateRawNonce\(\)/g) ?? []).length, 1, "raw nonce generated exactly once");
  assert.equal((google.match(/await sha256Hex\(/g) ?? []).length, 1, "hashed exactly once");

  // The raw nonce must be created BEFORE the login request, so the same pair
  // spans both the provider call and the Supabase exchange.
  const rawIndex = google.indexOf("const rawNonce = generateRawNonce()");
  const loginIndex = google.indexOf("SocialLogin.login");
  const exchangeIndex = google.indexOf("supabase.auth.signInWithIdToken");
  assert.ok(rawIndex > 0 && rawIndex < loginIndex, "the nonce must be generated before the login request");
  assert.ok(loginIndex < exchangeIndex, "the login request must precede the Supabase exchange");
});

// ── Decoding is diagnostics only ─────────────────────────────────────────────
test("the decoded token nonce is NOT used as authentication input", () => {
  const google = googleFlow();

  // The claim may only be read inside the development-diagnostics block.
  const decodeIndex = google.indexOf("readIdTokenNonce(idToken)");
  const devGuardIndex = google.indexOf('process.env.NODE_ENV !== "production"');
  const exchangeIndex = google.indexOf("supabase.auth.signInWithIdToken");

  assert.ok(decodeIndex > 0, "the token is still decoded for diagnostics");
  assert.ok(devGuardIndex > 0 && devGuardIndex < decodeIndex, "decoding must sit inside the dev-only guard");
  assert.ok(decodeIndex < exchangeIndex, "diagnostics run before the exchange");

  // The regression this replaces: the claim must never reach Supabase.
  assert.ok(
    !/signInWithIdToken\([\s\S]{0,400}nonce: (tokenNonce|claimedNonce)/.test(google),
    "the decoded claim must never be passed to Supabase",
  );
  assert.ok(
    !/const tokenNonce = readIdTokenNonce/.test(google),
    "the old token-mirroring variable must be gone",
  );
});

test("readIdTokenNonce still works as a diagnostic helper", () => {
  assert.equal(readIdTokenNonce(makeIdToken({ sub: "1", nonce: "abc" })), "abc");
  assert.equal(readIdTokenNonce(makeIdToken({ sub: "1" })), null);
  assert.equal(readIdTokenNonce(makeIdToken({ sub: "1", nonce: "  " })), null);
  assert.equal(readIdTokenNonce(makeIdToken({ sub: "1", nonce: 42 })), null);

  for (const bad of ["", "not-a-jwt", "a.b", "a..c", "..."]) {
    assert.doesNotThrow(() => readIdTokenNonce(bad));
  }

  assert.equal(decodeIdTokenPayload(makeIdToken({ name: "Renée Ångström" }))?.name, "Renée Ångström");
});

test("a hashed nonce round-trips through the token claim as Supabase expects", async () => {
  // Simulates the real exchange: we send hashed to Google, Google echoes it into
  // the claim, Supabase re-hashes our raw value and must reproduce that claim.
  const rawNonce = generateRawNonce();
  const hashedNonce = await sha256Hex(rawNonce);
  const token = makeIdToken({ sub: "1", nonce: hashedNonce });

  assert.equal(readIdTokenNonce(token), hashedNonce, "the claim should equal what we sent");
  assert.equal(await sha256Hex(rawNonce), readIdTokenNonce(token), "Supabase's re-hash must match the claim");
});

// ── Apple is untouched ───────────────────────────────────────────────────────
test("Apple still sends hashed to the provider and raw to Supabase", () => {
  const apple = appleFlow();

  assert.match(apple, /const rawNonce = generateRawNonce\(\)/);
  assert.match(apple, /const hashedNonce = await sha256Hex\(rawNonce\)/);
  assert.match(apple, /nonce: hashedNonce/, "Apple's request must carry the hashed nonce");
  assert.match(
    apple,
    /signInWithIdToken\(\{[\s\S]{0,160}provider: "apple",[\s\S]{0,160}nonce: rawNonce,/,
    "Supabase must receive Apple's RAW nonce",
  );

  assert.ok(!apple.includes("readIdTokenNonce"), "the Apple flow must not decode tokens");
});

test("the Apple and Google flows stay isolated", () => {
  const apple = appleFlow();
  const google = googleFlow();

  assert.ok(!apple.includes('provider: "google"'), "the Apple flow must not touch Google");
  assert.ok(!google.includes('provider: "apple"'), "the Google flow must not touch Apple");

  assert.equal((apple.match(/supabase\.auth\.signInWithIdToken\(/g) ?? []).length, 1);
  assert.equal((google.match(/supabase\.auth\.signInWithIdToken\(/g) ?? []).length, 1);
});

// ── Nothing sensitive is logged ──────────────────────────────────────────────
test("no token, raw nonce, or hashed nonce value is ever logged", () => {
  const google = googleFlow();
  const logCalls = google.match(/console\.(log|warn|error)\([\s\S]*?\);/g) ?? [];
  assert.ok(logCalls.length > 0, "expected diagnostics to exist");

  // A logged VALUE is a bare identifier argument — i.e. followed directly by a
  // comma or the closing paren. `claimedNonce !== null` is a boolean and is
  // fine; `claimedNonce` on its own is not.
  const loggedAsValue = (call: string, identifier: string) =>
    new RegExp(`,\\s*${identifier}\\s*[),]`).test(call);

  for (const call of logCalls) {
    for (const secret of ["idToken", "rawNonce", "hashedNonce", "claimedNonce"]) {
      assert.ok(!loggedAsValue(call, secret), `${secret} must never be logged as a value: ${call}`);
    }
  }

  // The comparisons that ARE logged are booleans.
  assert.match(google, /nonce claim present:", claimedNonce !== null/);
  assert.match(google, /matches hashed nonce:", claimedNonce === hashedNonce/);
});

test("a dropped nonce is reported rather than silently tolerated", () => {
  const google = googleFlow();

  assert.match(google, /NO nonce claim despite one being supplied/, "the failure must be reported explicitly");
  assert.match(google, /web implementation/, "it must point at the likely cause");

  // Crucially: no conditional that omits the nonce when the claim is missing.
  assert.ok(
    !/nonce: rawNonce\s*\}\s*:\s*\{ provider: "google", token: idToken \}/.test(google),
    "there must be no fallback that drops the nonce",
  );
});
