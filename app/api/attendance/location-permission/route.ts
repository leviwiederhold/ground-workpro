import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getEffectiveRole } from "@/lib/auth/effectiveRole";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isBackgroundReady, type LocationPermissionSnapshot } from "@/lib/attendance/backgroundLocation";

export const dynamic = "force-dynamic";

const permissionLevel = z.enum(["granted", "denied", "prompt", "unavailable", "unknown"]);

const putSchema = z.object({
  locationServicesEnabled: z.boolean().nullable().optional(),
  foreground: permissionLevel.optional(),
  background: permissionLevel.optional(),
  precise: z.boolean().nullable().optional(),
  platform: z.enum(["ios", "android", "web", "unknown"]).optional(),
  onboardingCompleted: z.boolean().optional(),
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
      const items = (result.data ?? []).map((row: Record<string, unknown>) => {
        const snapshot = rowToSnapshot(row);
        return {
          userId: row.user_id,
          onboardingCompletedAt: row.onboarding_completed_at ?? null,
          snapshot,
          // The admin cares about one thing: is automatic attendance actually
          // configured (background-ready) for this person?
          automaticAttendanceConfigured: isBackgroundReady(snapshot),
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
    return NextResponse.json({
      item: {
        onboardingCompletedAt: (result.data as Record<string, unknown>).onboarding_completed_at ?? null,
        snapshot,
        automaticAttendanceConfigured: isBackgroundReady(snapshot),
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
    if (d.onboardingCompleted) payload.onboarding_completed_at = new Date().toISOString();

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
    return NextResponse.json({
      item: {
        onboardingCompletedAt: (result.data as Record<string, unknown>).onboarding_completed_at ?? null,
        snapshot,
        automaticAttendanceConfigured: isBackgroundReady(snapshot),
      },
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}
