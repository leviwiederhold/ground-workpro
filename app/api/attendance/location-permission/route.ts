import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getEffectiveRole } from "@/lib/auth/effectiveRole";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  isReportedAttendanceSetupComplete,
  type LocationPermissionSnapshot,
} from "@/lib/attendance/backgroundLocation";

export const dynamic = "force-dynamic";

const permissionLevel = z.enum(["granted", "denied", "prompt", "unavailable", "unknown"]);

const putSchema = z.object({
  locationServicesEnabled: z.boolean().nullable().optional(),
  foreground: permissionLevel.optional(),
  background: permissionLevel.optional(),
  precise: z.boolean().nullable().optional(),
  platform: z.enum(["ios", "android", "web", "unknown"]).optional(),
  onboardingCompleted: z.boolean().optional(),
  setupComplete: z.boolean().optional(),
  nativeServiceSupported: z.boolean().optional(),
  nativeServiceHealthy: z.boolean().optional(),
  backgroundRefreshEnabled: z.boolean().optional(),
  nativeHasSecureCredential: z.boolean().optional(),
  requiredRegionIds: z.array(z.string().min(1).max(300)).max(20).optional(),
  registeredRegionIds: z.array(z.string().min(1).max(300)).max(20).optional(),
});

function rowToSnapshot(row: Record<string, unknown>): LocationPermissionSnapshot {
  return {
    locationServicesEnabled: (row.location_services_enabled as boolean | null) ?? null,
    foreground: String(row.foreground ?? "unknown") as LocationPermissionSnapshot["foreground"],
    background: String(row.background ?? "unknown") as LocationPermissionSnapshot["background"],
    precise: (row.precise as boolean | null) ?? null,
    platform: String(row.platform ?? "unknown") as LocationPermissionSnapshot["platform"],
    capturedAt: String(row.updated_at ?? new Date().toISOString()),
  };
}

// GET returns the caller's own permission row. Managers (admin/pm) may pass
// ?scope=company to list every employee's configured state for the admin
// visibility view.
export async function GET(request: Request) {
  try {
    const { supabase, companyId, userId } = await getCompanyId();
    const db = getSupabaseAdmin() ?? supabase;
    const scope = new URL(request.url).searchParams.get("scope");

    if (scope === "company") {
      const role = await getEffectiveRole();
      if (role !== "admin" && role !== "pm") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const result = await db
        .from("employee_location_permissions")
        .select("*")
        .eq("company_id", companyId);
      if (result.error) {
        return NextResponse.json({ error: result.error.message }, { status: 400 });
      }
      const userIds = (result.data ?? [])
        .map((row: Record<string, unknown>) => String(row.user_id ?? ""))
        .filter(Boolean);
      const credentialResult =
        userIds.length > 0
          ? await db
              .from("device_attendance_credentials")
              .select("user_id")
              .eq("company_id", companyId)
              .in("user_id", userIds)
              .is("revoked_at", null)
              .gt("expires_at", new Date().toISOString())
          : { data: [] as Array<{ user_id: string }> };
      if ("error" in credentialResult && credentialResult.error) {
        return NextResponse.json(
          { error: credentialResult.error.message },
          { status: 400 },
        );
      }
      const activeCredentialUsers = new Set(
        (credentialResult.data ?? []).map((row: { user_id: string }) => String(row.user_id)),
      );
      const items = (result.data ?? []).map((row: Record<string, unknown>) => {
        const snapshot = rowToSnapshot(row);
        const onboardingCompletedAt = (row.onboarding_completed_at as string | null) ?? null;
        return {
          userId: row.user_id,
          onboardingCompletedAt,
          snapshot,
          automaticAttendanceConfigured: isReportedAttendanceSetupComplete({
            snapshot,
            onboardingCompletedAt,
            hasActiveCredential: activeCredentialUsers.has(String(row.user_id)),
          }),
        };
      });
      return NextResponse.json({ items });
    }

    const result = await db
      .from("employee_location_permissions")
      .select("*")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .maybeSingle();
    if (result.error) {
      return NextResponse.json({ error: result.error.message }, { status: 400 });
    }
    if (!result.data) {
      return NextResponse.json({ item: { onboardingCompletedAt: null, snapshot: null } });
    }
    const snapshot = rowToSnapshot(result.data as Record<string, unknown>);
    const credential = await db
      .from("device_attendance_credentials")
      .select("id")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .limit(1)
      .maybeSingle();
    if (credential.error) {
      return NextResponse.json({ error: credential.error.message }, { status: 400 });
    }
    const onboardingCompletedAt =
      (result.data as Record<string, unknown>).onboarding_completed_at as string | null;
    return NextResponse.json({
      item: {
        onboardingCompletedAt: onboardingCompletedAt ?? null,
        snapshot,
        automaticAttendanceConfigured: isReportedAttendanceSetupComplete({
          snapshot,
          onboardingCompletedAt: onboardingCompletedAt ?? null,
          hasActiveCredential: Boolean(credential.data),
        }),
      },
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}

// PUT upserts the caller's own permission snapshot.
export async function PUT(request: Request) {
  try {
    const { supabase, companyId, userId } = await getCompanyId();
    const parsed = putSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation error", details: parsed.error.flatten() }, { status: 422 });
    }
    const d = parsed.data;

    const payload: Record<string, unknown> = {
      company_id: companyId,
      user_id: userId,
      updated_at: new Date().toISOString(),
    };
    if (d.locationServicesEnabled !== undefined) payload.location_services_enabled = d.locationServicesEnabled;
    if (d.foreground !== undefined) payload.foreground = d.foreground;
    if (d.background !== undefined) payload.background = d.background;
    if (d.precise !== undefined) payload.precise = d.precise;
    if (d.platform !== undefined) payload.platform = d.platform;
    if (d.nativeServiceSupported !== undefined) {
      payload.native_service_supported = d.nativeServiceSupported;
    }
    if (d.nativeServiceHealthy !== undefined) {
      payload.native_service_healthy = d.nativeServiceHealthy;
    }
    if (d.backgroundRefreshEnabled !== undefined) {
      payload.background_refresh_enabled = d.backgroundRefreshEnabled;
    }
    if (d.nativeHasSecureCredential !== undefined) {
      payload.native_has_secure_credential = d.nativeHasSecureCredential;
    }
    if (d.requiredRegionIds !== undefined) {
      payload.required_region_ids = [...new Set(d.requiredRegionIds)].sort();
    }
    if (d.registeredRegionIds !== undefined) {
      payload.registered_region_ids = [...new Set(d.registeredRegionIds)].sort();
    }
    if (
      d.nativeServiceSupported !== undefined ||
      d.nativeServiceHealthy !== undefined ||
      d.backgroundRefreshEnabled !== undefined ||
      d.nativeHasSecureCredential !== undefined ||
      d.requiredRegionIds !== undefined ||
      d.registeredRegionIds !== undefined
    ) {
      payload.native_readiness_reported_at = new Date().toISOString();
    }
    if (d.setupComplete === true || d.onboardingCompleted) {
      payload.onboarding_completed_at = new Date().toISOString();
    } else if (d.setupComplete === false) {
      payload.onboarding_completed_at = null;
    }

    const db = getSupabaseAdmin() ?? supabase;
    const result = await db
      .from("employee_location_permissions")
      .upsert(payload, { onConflict: "company_id,user_id" })
      .select("*")
      .maybeSingle();
    if (result.error) {
      return NextResponse.json({ error: result.error.message }, { status: 400 });
    }
    const snapshot = rowToSnapshot(result.data as Record<string, unknown>);
    const credential = await db
      .from("device_attendance_credentials")
      .select("id")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .limit(1)
      .maybeSingle();
    if (credential.error) {
      return NextResponse.json({ error: credential.error.message }, { status: 400 });
    }
    const onboardingCompletedAt =
      (result.data as Record<string, unknown>).onboarding_completed_at as string | null;
    return NextResponse.json({
      item: {
        onboardingCompletedAt: onboardingCompletedAt ?? null,
        snapshot,
        automaticAttendanceConfigured: isReportedAttendanceSetupComplete({
          snapshot,
          onboardingCompletedAt: onboardingCompletedAt ?? null,
          hasActiveCredential: Boolean(credential.data),
        }),
      },
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}
