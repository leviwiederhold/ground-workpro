import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTENDANCE_TOKEN_PREFIX,
  buildIdempotencyKey,
  generateAttendanceToken,
  hashToken,
  parseBearerToken,
  validateEventTimestamp,
} from "../../src/lib/attendance/deviceCredential.ts";

test("generateAttendanceToken is prefixed, opaque, and unique", () => {
  const a = generateAttendanceToken();
  const b = generateAttendanceToken();
  assert.ok(a.startsWith(ATTENDANCE_TOKEN_PREFIX));
  assert.notEqual(a, b);
  assert.ok(a.length > 40);
});

test("hashToken is deterministic and differs per token; never returns the token", async () => {
  const token = generateAttendanceToken();
  const h1 = await hashToken(token);
  const h2 = await hashToken(token);
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.notEqual(h1, token);
  assert.notEqual(await hashToken(generateAttendanceToken()), h1);
});

test("parseBearerToken accepts only a well-formed attendance bearer", () => {
  const token = generateAttendanceToken();
  assert.equal(parseBearerToken(`Bearer ${token}`), token);
  assert.equal(parseBearerToken(`bearer ${token}`), token); // case-insensitive scheme
  assert.equal(parseBearerToken(null), null);
  assert.equal(parseBearerToken("Basic abc"), null);
  assert.equal(parseBearerToken("Bearer some-other-token"), null); // wrong prefix
  assert.equal(parseBearerToken(token), null); // missing scheme
});

test("buildIdempotencyKey dedupes within the minute but separates distinct transitions", () => {
  const base = { credentialId: "cred-1", jobId: "job-1", zone: "arrival", transition: "enter" };
  const k1 = buildIdempotencyKey({ ...base, occurredAt: "2026-07-20T14:00:10.000Z" });
  const k2 = buildIdempotencyKey({ ...base, occurredAt: "2026-07-20T14:00:55.000Z" });
  assert.equal(k1, k2, "same minute → same key");

  const diffMinute = buildIdempotencyKey({ ...base, occurredAt: "2026-07-20T14:01:10.000Z" });
  const diffZone = buildIdempotencyKey({ ...base, zone: "wake", occurredAt: "2026-07-20T14:00:10.000Z" });
  const diffTransition = buildIdempotencyKey({ ...base, transition: "exit", occurredAt: "2026-07-20T14:00:10.000Z" });
  const diffJob = buildIdempotencyKey({ ...base, jobId: "job-2", occurredAt: "2026-07-20T14:00:10.000Z" });
  for (const k of [diffMinute, diffZone, diffTransition, diffJob]) assert.notEqual(k, k1);
});

test("validateEventTimestamp rejects stale, future-skewed, and invalid timestamps", () => {
  const now = new Date("2026-07-20T15:00:00.000Z");
  assert.deepEqual(validateEventTimestamp("2026-07-20T14:59:00.000Z", now), { ok: true });
  assert.deepEqual(validateEventTimestamp("2026-07-20T13:00:00.000Z", now), { ok: false, reason: "too_old" });
  assert.deepEqual(validateEventTimestamp("2026-07-20T15:10:00.000Z", now), { ok: false, reason: "too_future" });
  assert.deepEqual(validateEventTimestamp("not-a-date", now), { ok: false, reason: "invalid" });
});
