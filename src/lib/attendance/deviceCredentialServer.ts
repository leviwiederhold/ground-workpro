/* eslint-disable @typescript-eslint/no-explicit-any */
// Server-side device attendance credential operations. All writes/reads go
// through the service-role admin client because the verify path has no user
// session (a background native POST carries only the bearer token).

import {
  ATTENDANCE_SCOPE,
  expiresAtFromNow,
  generateAttendanceRefreshToken,
  generateAttendanceToken,
  hashToken,
  parseAttendanceRefreshBearer,
  parseBearerToken,
  refreshExpiresAtFromNow,
} from "./deviceCredential.ts";

export type AttendanceCredentialContext = {
  credentialId: string;
  companyId: string;
  userId: string;
  employeeId: string | null;
  deviceId: string;
};

export type MintedCredential = {
  token: string;
  credentialId: string;
  expiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
};

/**
 * Mint (or rotate) the credential for one device. Any existing active
 * credential for the same (company, user, device) is revoked first, so a device
 * only ever has one live credential and rotation is a single call.
 */
export async function mintDeviceCredential(
  admin: any,
  params: { companyId: string; userId: string; employeeId: string | null; deviceId: string; platform?: string | null }
): Promise<MintedCredential | { error: string }> {
  const token = generateAttendanceToken();
  const refreshToken = generateAttendanceRefreshToken();
  const token_hash = await hashToken(token);
  const refresh_token_hash = await hashToken(refreshToken);
  const expiresAt = expiresAtFromNow();
  const refreshExpiresAt = refreshExpiresAtFromNow();

  // Revoke any prior active credential for this device (rotation / re-enroll).
  await admin
    .from("device_attendance_credentials")
    .update({ revoked_at: new Date().toISOString() })
    .eq("company_id", params.companyId)
    .eq("user_id", params.userId)
    .eq("device_id", params.deviceId)
    .is("revoked_at", null);

  const insert = await admin
    .from("device_attendance_credentials")
    .insert({
      company_id: params.companyId,
      user_id: params.userId,
      employee_id: params.employeeId,
      device_id: params.deviceId,
      platform: params.platform ?? null,
      token_hash,
      refresh_token_hash,
      scope: ATTENDANCE_SCOPE,
      expires_at: expiresAt,
      refresh_expires_at: refreshExpiresAt,
    })
    .select("id")
    .maybeSingle();

  if (insert.error) return { error: insert.error.message };
  return {
    token,
    credentialId: String(insert.data?.id ?? ""),
    expiresAt,
    refreshToken,
    refreshExpiresAt,
  };
}

/**
 * Verify the refresh-only secret. It remains usable after the short-lived
 * access token expires, but never after device/user revocation or its own
 * bounded expiry.
 */
export async function verifyAttendanceRefreshCredential(
  admin: any,
  request: Request,
): Promise<AttendanceCredentialContext | null> {
  const token = parseAttendanceRefreshBearer(request.headers.get("authorization"));
  if (!token) return null;
  let refreshTokenHash: string;
  try {
    refreshTokenHash = await hashToken(token);
  } catch {
    return null;
  }
  const result = await admin
    .from("device_attendance_credentials")
    .select("id, company_id, user_id, employee_id, device_id, scope, refresh_expires_at, revoked_at")
    .eq("refresh_token_hash", refreshTokenHash)
    .maybeSingle();
  const row = result.data;
  if (result.error || !row || row.revoked_at || row.scope !== ATTENDANCE_SCOPE) return null;
  if (!row.refresh_expires_at || Date.parse(row.refresh_expires_at) <= Date.now()) return null;
  return {
    credentialId: String(row.id),
    companyId: String(row.company_id),
    userId: String(row.user_id),
    employeeId: row.employee_id ? String(row.employee_id) : null,
    deviceId: String(row.device_id),
  };
}

/** Rotate only the access secret; the stable refresh secret survives response loss. */
export async function refreshAttendanceAccessToken(
  admin: any,
  credential: AttendanceCredentialContext,
): Promise<{ token: string; expiresAt: string } | { error: string }> {
  const token = generateAttendanceToken();
  const tokenHash = await hashToken(token);
  const expiresAt = expiresAtFromNow();
  const result = await admin
    .from("device_attendance_credentials")
    .update({
      token_hash: tokenHash,
      expires_at: expiresAt,
      last_refreshed_at: new Date().toISOString(),
    })
    .eq("id", credential.credentialId)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (result.error || !result.data) {
    return { error: result.error?.message ?? "Attendance credential is no longer active" };
  }
  return { token, expiresAt };
}

/**
 * One-time upgrade for devices enrolled before refresh credentials existed.
 * The still-valid access bearer already proves the same attendance-only device
 * authority. It can add a refresh secret only while the row has none; it never
 * replaces an established refresh credential.
 */
export async function bootstrapLegacyAttendanceRefreshCredential(
  admin: any,
  credential: AttendanceCredentialContext,
): Promise<
  | { refreshToken: string; refreshExpiresAt: string; expiresAt: string }
  | { error: string }
> {
  const refreshToken = generateAttendanceRefreshToken();
  const refreshTokenHash = await hashToken(refreshToken);
  const refreshExpiresAt = refreshExpiresAtFromNow();
  const result = await admin
    .from("device_attendance_credentials")
    .update({
      refresh_token_hash: refreshTokenHash,
      refresh_expires_at: refreshExpiresAt,
      last_refreshed_at: new Date().toISOString(),
    })
    .eq("id", credential.credentialId)
    .is("revoked_at", null)
    .is("refresh_token_hash", null)
    .select("id, expires_at")
    .maybeSingle();
  if (result.error || !result.data?.expires_at) {
    return {
      error: result.error?.message ?? "Legacy attendance credential was already upgraded",
    };
  }
  return {
    refreshToken,
    refreshExpiresAt,
    expiresAt: String(result.data.expires_at),
  };
}

/** Revoke a device's credential (logout cleanup / re-enroll). */
export async function revokeDeviceCredential(
  admin: any,
  params: { companyId: string; userId: string; deviceId?: string | null }
): Promise<void> {
  let query = admin
    .from("device_attendance_credentials")
    .update({ revoked_at: new Date().toISOString() })
    .eq("company_id", params.companyId)
    .eq("user_id", params.userId)
    .is("revoked_at", null);
  if (params.deviceId) query = query.eq("device_id", params.deviceId);
  await query;
}

/** Revoke ALL of a user's device credentials (logout cleanup, across devices). */
export async function revokeAllDeviceCredentialsForUser(admin: any, userId: string): Promise<void> {
  await admin
    .from("device_attendance_credentials")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("revoked_at", null);
}

/**
 * Verify a bearer attendance token from the request. Returns the resolved
 * identity, or null when the token is missing/malformed/unknown/expired/revoked
 * or not scoped to attendance events. Never throws.
 */
export async function verifyAttendanceCredential(
  admin: any,
  request: Request
): Promise<AttendanceCredentialContext | null> {
  const token = parseBearerToken(request.headers.get("authorization"));
  if (!token) return null;
  let token_hash: string;
  try {
    token_hash = await hashToken(token);
  } catch {
    return null;
  }

  const result = await admin
    .from("device_attendance_credentials")
    .select("id, company_id, user_id, employee_id, device_id, scope, expires_at, revoked_at")
    .eq("token_hash", token_hash)
    .maybeSingle();
  const row = result.data;
  if (result.error || !row) return null;
  if (row.revoked_at) return null;
  if (row.scope !== ATTENDANCE_SCOPE) return null;
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) return null;

  // Best-effort last-used bookkeeping (never blocks the request).
  admin
    .from("device_attendance_credentials")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", row.id)
    .then(() => {}, () => {});

  return {
    credentialId: String(row.id),
    companyId: String(row.company_id),
    userId: String(row.user_id),
    employeeId: row.employee_id ? String(row.employee_id) : null,
    deviceId: String(row.device_id),
  };
}
