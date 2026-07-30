// Authenticated native readiness + lifecycle diagnostics.
//
// This endpoint is intentionally cookie-independent: iOS calls it after a
// background Core Location wake, before Capacitor or the WebView exists.  The
// restricted attendance device credential resolves company/user/device.
//
// Privacy: reports contain service/permission/registration state and discrete
// pipeline stages only. They never include coordinates or a continuous
// location trail, and the diagnostic table is service-role-only.

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ATTENDANCE_UNAVAILABLE_MESSAGE,
  getAttendanceWriteDb,
} from "@/lib/attendance/attendanceDb";
import { verifyAttendanceCredential } from "@/lib/attendance/deviceCredentialServer";

export const dynamic = "force-dynamic";

const authorizationStatus = z.enum([
  "not_determined",
  "restricted",
  "denied",
  "authorized_when_in_use",
  "authorized_always",
  "unknown",
]);

const diagnosticValue = z.union([z.string().max(500), z.number(), z.boolean(), z.null()]);
const diagnosticSchema = z.object({
  id: z.string().min(1).max(200),
  code: z.string().min(1).max(100),
  stage: z.string().min(1).max(100),
  status: z.enum(["started", "succeeded", "failed", "observed"]),
  occurredAt: z.string().datetime(),
  regionIdentifier: z.string().max(300).nullable().optional(),
  transition: z.enum(["enter", "exit"]).nullable().optional(),
  details: z.record(z.string(), diagnosticValue).optional(),
});

const bodySchema = z.object({
  readiness: z.object({
    supported: z.boolean(),
    authorizationStatus,
    locationServicesEnabled: z.boolean(),
    backgroundRefreshEnabled: z.boolean(),
    preciseLocation: z.boolean(),
    hasCredential: z.boolean(),
    requiredRegionIds: z.array(z.string().min(1).max(300)).max(20),
    registeredRegionIds: z.array(z.string().min(1).max(300)).max(20),
    reportedAt: z.string().datetime(),
  }),
  diagnostics: z.array(diagnosticSchema).max(100).default([]),
});

export async function POST(request: Request) {
  try {
    const db = getAttendanceWriteDb("POST /api/attendance/native-readiness");
    if (!db) {
      return NextResponse.json({ error: ATTENDANCE_UNAVAILABLE_MESSAGE }, { status: 503 });
    }

    const credential = await verifyAttendanceCredential(db, request);
    if (!credential) {
      return NextResponse.json({ error: "Invalid or expired attendance credential" }, { status: 401 });
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation error", details: parsed.error.flatten() },
        { status: 422 },
      );
    }

    const { readiness, diagnostics } = parsed.data;
    const required = new Set(readiness.requiredRegionIds);
    const registered = new Set(readiness.registeredRegionIds);
    // Service health is one dimension, not an aggregate alias for "configured."
    // Authorization, accuracy, credential and region registration are evaluated
    // independently by the authoritative setup-health contract.
    const nativeServiceHealthy =
      readiness.supported &&
      readiness.locationServicesEnabled &&
      readiness.backgroundRefreshEnabled;
    const setupComplete =
      nativeServiceHealthy &&
      readiness.authorizationStatus === "authorized_always" &&
      readiness.preciseLocation &&
      readiness.hasCredential &&
      required.size > 0 &&
      [...required].every((identifier) => registered.has(identifier));

    const permissionWrite = await db
      .from("employee_location_permissions")
      .upsert(
        {
          company_id: credential.companyId,
          user_id: credential.userId,
          location_services_enabled: readiness.locationServicesEnabled,
          foreground:
            readiness.authorizationStatus === "authorized_always" ||
            readiness.authorizationStatus === "authorized_when_in_use"
              ? "granted"
              : readiness.authorizationStatus === "not_determined"
                ? "prompt"
                : "denied",
          background:
            readiness.authorizationStatus === "authorized_always"
              ? "granted"
              : readiness.authorizationStatus === "not_determined" ||
                  readiness.authorizationStatus === "authorized_when_in_use"
                ? "prompt"
                : "denied",
          precise: readiness.preciseLocation,
          platform: "ios",
          background_refresh_enabled: readiness.backgroundRefreshEnabled,
          native_service_supported: readiness.supported,
          native_service_healthy: nativeServiceHealthy,
          native_has_secure_credential: readiness.hasCredential,
          required_region_ids: [...required].sort(),
          registered_region_ids: [...registered].sort(),
          native_device_id: credential.deviceId,
          native_readiness_reported_at: readiness.reportedAt,
          ...(setupComplete ? { onboarding_completed_at: readiness.reportedAt } : {}),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "company_id,user_id" },
      );
    if (permissionWrite.error) {
      return NextResponse.json({ error: permissionWrite.error.message }, { status: 400 });
    }

    if (diagnostics.length > 0) {
      const rows = diagnostics.map((item) => ({
        diagnostic_id: item.id,
        credential_id: credential.credentialId,
        company_id: credential.companyId,
        user_id: credential.userId,
        employee_id: credential.employeeId,
        device_id: credential.deviceId,
        code: item.code,
        stage: item.stage,
        status: item.status,
        region_identifier: item.regionIdentifier ?? null,
        transition: item.transition ?? null,
        occurred_at: item.occurredAt,
        details: item.details ?? {},
      }));
      const diagnosticWrite = await db
        .from("attendance_native_diagnostics")
        .upsert(rows, {
          onConflict: "credential_id,diagnostic_id",
          ignoreDuplicates: true,
        });
      if (diagnosticWrite.error) {
        return NextResponse.json({ error: diagnosticWrite.error.message }, { status: 400 });
      }
    }

    return NextResponse.json({
      ok: true,
      nativeServiceHealthy,
      acceptedDiagnosticIds: diagnostics.map((item) => item.id),
    });
  } catch {
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}
