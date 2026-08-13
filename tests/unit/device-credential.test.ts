import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTENDANCE_REFRESH_TOKEN_PREFIX,
  ATTENDANCE_TOKEN_PREFIX,
  buildIdempotencyKey,
  generateAttendanceRefreshToken,
  generateAttendanceToken,
  hashToken,
  parseAttendanceRefreshBearer,
  parseBearerToken,
  validateEventTimestamp,
} from "../../src/lib/attendance/deviceCredential.ts";
import {
  bootstrapLegacyAttendanceRefreshCredential,
  verifyAttendanceRefreshCredential,
} from "../../src/lib/attendance/deviceCredentialServer.ts";

function refreshLookup(row: Record<string, unknown> | null) {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return chain;
}

test("generateAttendanceToken is prefixed, opaque, and unique", () => {
  const a = generateAttendanceToken();
  const b = generateAttendanceToken();
  assert.ok(a.startsWith(ATTENDANCE_TOKEN_PREFIX));
  assert.notEqual(a, b);
  assert.ok(a.length > 40);
});

test("refresh credentials are independent and rejected by the access parser", () => {
  const refresh = generateAttendanceRefreshToken();
  assert.ok(refresh.startsWith(ATTENDANCE_REFRESH_TOKEN_PREFIX));
  assert.equal(parseAttendanceRefreshBearer(`Bearer ${refresh}`), refresh);
  assert.equal(parseBearerToken(`Bearer ${refresh}`), null);
  const access = generateAttendanceToken();
  assert.equal(parseAttendanceRefreshBearer(`Bearer ${access}`), null);
});

test("refresh verification accepts an active device and rejects expiry or revocation", async () => {
  const refresh = generateAttendanceRefreshToken();
  const request = new Request("https://example.test/api/attendance/device-credential/refresh", {
    headers: { Authorization: `Bearer ${refresh}` },
  });
  const active = {
    id: "credential-1",
    company_id: "company-1",
    user_id: "user-1",
    employee_id: "employee-1",
    device_id: "device-1",
    scope: "attendance:events",
    refresh_expires_at: "2099-01-01T00:00:00.000Z",
    revoked_at: null,
  };

  assert.deepEqual(await verifyAttendanceRefreshCredential(refreshLookup(active), request), {
    credentialId: "credential-1",
    companyId: "company-1",
    userId: "user-1",
    employeeId: "employee-1",
    deviceId: "device-1",
  });
  assert.equal(
    await verifyAttendanceRefreshCredential(
      refreshLookup({ ...active, refresh_expires_at: "2000-01-01T00:00:00.000Z" }),
      request,
    ),
    null,
  );
  assert.equal(
    await verifyAttendanceRefreshCredential(
      refreshLookup({ ...active, revoked_at: "2026-08-10T12:00:00.000Z" }),
      request,
    ),
    null,
  );
});

test("a legacy device can add one refresh secret without rotating its access token", async () => {
  type BootstrapChain = {
    from: () => BootstrapChain;
    update: (value: Record<string, unknown>) => BootstrapChain;
    eq: () => BootstrapChain;
    is: () => BootstrapChain;
    select: () => BootstrapChain;
    maybeSingle: () => Promise<{
      data: { id: string; expires_at: string };
      error: null;
    }>;
  };
  let capturedUpdate: Record<string, unknown> = {};
  const chain = {} as BootstrapChain;
  chain.from = () => chain;
  chain.update = (value: Record<string, unknown>) => {
    capturedUpdate = value;
    return chain;
  };
  chain.eq = () => chain;
  chain.is = () => chain;
  chain.select = () => chain;
  chain.maybeSingle = async () => ({
    data: { id: "credential-1", expires_at: "2026-09-09T00:00:00.000Z" },
    error: null,
  });

  const result = await bootstrapLegacyAttendanceRefreshCredential(chain, {
    credentialId: "credential-1",
    companyId: "company-1",
    userId: "user-1",
    employeeId: "employee-1",
    deviceId: "device-1",
  });
  assert.ok(!("error" in result));
  if ("error" in result) return;
  assert.ok(result.refreshToken.startsWith(ATTENDANCE_REFRESH_TOKEN_PREFIX));
  assert.equal(result.expiresAt, "2026-09-09T00:00:00.000Z");
  assert.ok(capturedUpdate.refresh_token_hash);
  assert.equal("token_hash" in capturedUpdate, false, "legacy access token must remain valid");
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
