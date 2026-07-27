// Device-scoped attendance credential primitives (pure).
//
// A device credential is a random bearer secret a signed-in employee mints for
// ONE device. It authenticates ONLY attendance event submission and carries no
// user password and no general Supabase access. The server stores only a hash
// of the secret; the plaintext is shown to the client exactly once (to be kept
// in the iOS Keychain / Android Keystore).

export const ATTENDANCE_SCOPE = "attendance:events";
export const ATTENDANCE_TOKEN_PREFIX = "gwa_";
// Credentials expire and must be rotated; 30 days balances churn vs exposure.
export const ATTENDANCE_TOKEN_TTL_DAYS = 30;
// A background transition older than this is stale (likely a replay/queue flush
// gone wrong); more than this into the future indicates a bad clock.
export const ATTENDANCE_EVENT_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
export const ATTENDANCE_EVENT_MAX_SKEW_MS = 5 * 60 * 1000; // 5 minutes

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Generate a new opaque attendance token (prefix + 256 bits of randomness). */
export function generateAttendanceToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `${ATTENDANCE_TOKEN_PREFIX}${toBase64Url(bytes)}`;
}

/** SHA-256 hex of the token — only the hash is ever persisted. */
export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Extract a bearer token from an Authorization header, if present + shaped right. */
export function parseBearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  if (!token || !token.startsWith(ATTENDANCE_TOKEN_PREFIX)) return null;
  return token;
}

export function expiresAtFromNow(now: Date = new Date(), ttlDays = ATTENDANCE_TOKEN_TTL_DAYS): string {
  return new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Idempotency key for a transition. Truncated to the minute so a duplicate
 * native delivery of the same enter/exit dedupes, while genuinely distinct
 * transitions (different minute/zone/job) do not collide.
 */
export function buildIdempotencyKey(parts: {
  credentialId: string;
  jobId: string | number;
  zone: string;
  transition: string;
  occurredAt: string;
}): string {
  const minute = parts.occurredAt.slice(0, 16); // YYYY-MM-DDTHH:mm
  return [parts.credentialId, String(parts.jobId), parts.zone, parts.transition, minute].join("|");
}

export type TimestampCheck = { ok: true } | { ok: false; reason: "too_old" | "too_future" | "invalid" };

/** Reject events with an unparseable, stale, or future-skewed timestamp. */
export function validateEventTimestamp(
  occurredAt: string,
  now: Date = new Date(),
  maxAgeMs = ATTENDANCE_EVENT_MAX_AGE_MS,
  maxSkewMs = ATTENDANCE_EVENT_MAX_SKEW_MS
): TimestampCheck {
  const t = Date.parse(occurredAt);
  if (!Number.isFinite(t)) return { ok: false, reason: "invalid" };
  const delta = now.getTime() - t;
  if (delta > maxAgeMs) return { ok: false, reason: "too_old" };
  if (delta < -maxSkewMs) return { ok: false, reason: "too_future" };
  return { ok: true };
}
