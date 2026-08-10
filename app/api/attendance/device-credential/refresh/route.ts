// Cookie-independent access-token renewal for the headless native attendance
// process. The refresh bearer is device-bound, attendance-only, separately
// hashed, bounded to one year, and invalidated by the same revocation as the
// ordinary access token.

import { NextResponse } from "next/server";
import {
  ATTENDANCE_UNAVAILABLE_MESSAGE,
  getAttendanceWriteDb,
} from "@/lib/attendance/attendanceDb";
import {
  bootstrapLegacyAttendanceRefreshCredential,
  refreshAttendanceAccessToken,
  verifyAttendanceCredential,
  verifyAttendanceRefreshCredential,
} from "@/lib/attendance/deviceCredentialServer";
import { parseBearerToken } from "@/lib/attendance/deviceCredential";
import { enforceRateLimit } from "@/lib/http/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rateLimited = enforceRateLimit(request, {
    keyPrefix: "attendance-credential-refresh",
    limit: 10,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  const db = getAttendanceWriteDb("POST /api/attendance/device-credential/refresh");
  if (!db) {
    return NextResponse.json({ error: ATTENDANCE_UNAVAILABLE_MESSAGE }, { status: 503 });
  }
  const refreshCredential = await verifyAttendanceRefreshCredential(db, request);
  if (refreshCredential) {
    const refreshed = await refreshAttendanceAccessToken(db, refreshCredential);
    if ("error" in refreshed) {
      return NextResponse.json({ error: refreshed.error }, { status: 401 });
    }
    return NextResponse.json({
      token: refreshed.token,
      expiresAt: refreshed.expiresAt,
      deviceId: refreshCredential.deviceId,
    });
  }

  // One-time, headless upgrade for devices enrolled by an older release. This
  // keeps the app update itself from introducing a new "open and sign in"
  // requirement. Only an unexpired attendance access token can perform it, and
  // it cannot overwrite an established refresh credential.
  const accessToken = parseBearerToken(request.headers.get("authorization"));
  const accessCredential = accessToken
    ? await verifyAttendanceCredential(db, request)
    : null;
  if (!accessToken || !accessCredential) {
    return NextResponse.json(
      { error: "Invalid, expired, or revoked attendance refresh credential" },
      { status: 401 },
    );
  }
  const bootstrapped = await bootstrapLegacyAttendanceRefreshCredential(db, accessCredential);
  if ("error" in bootstrapped) {
    return NextResponse.json({ error: bootstrapped.error }, { status: 409 });
  }
  return NextResponse.json({
    token: accessToken,
    expiresAt: bootstrapped.expiresAt,
    refreshToken: bootstrapped.refreshToken,
    refreshExpiresAt: bootstrapped.refreshExpiresAt,
    deviceId: accessCredential.deviceId,
  });
}
