/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getEffectiveRole } from "@/lib/auth/effectiveRole";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  ALLOWED_ARRIVAL_RADII_FEET,
  ALLOWED_ARRIVAL_CONFIRMATION_SECONDS,
  ALLOWED_DEPARTURE_GRACE_MINUTES,
  ALLOWED_WAKE_RADII_METERS,
  DEFAULT_JOBSITE_TIME_SETTINGS,
  mapCompanyJobsiteSettings,
} from "@/lib/jobsite-time/domain";

export const dynamic = "force-dynamic";

const SETTINGS_COLUMNS =
  "jobsite_time_enabled,jobsite_require_approval,jobsite_geofence_radius_feet,jobsite_wake_radius_meters,jobsite_departure_grace_minutes,jobsite_arrival_confirmation_seconds,jobsite_manual_fallback_enabled";

const isMissingColumn = (message: string | undefined) =>
  /column|Could not find the/i.test(String(message || "")) && /does not exist|not find/i.test(String(message || ""));

// Any company member may READ settings (the employee UI needs to know whether
// Attendance is on and the manual fallback is available).
export async function GET() {
  try {
    const { supabase, companyId } = await getCompanyId();
    const db = getSupabaseAdmin() ?? supabase;
    const result = await db.from("companies").select(SETTINGS_COLUMNS).eq("id", companyId).maybeSingle();
    if (result.error) {
      if (isMissingColumn(result.error.message)) {
        return NextResponse.json({ item: DEFAULT_JOBSITE_TIME_SETTINGS });
      }
      return NextResponse.json({ error: result.error.message }, { status: 400 });
    }
    return NextResponse.json({ item: mapCompanyJobsiteSettings(result.data) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}

// NOTE: `enabled` is intentionally NOT accepted here. Attendance is permanent
// for every company; the legacy jobsite_time_enabled column is no longer a
// product gate and is never written from the UI.
const patchSchema = z.object({
  requireApproval: z.boolean().optional(),
  wakeRadiusMeters: z.number().refine((v) => ALLOWED_WAKE_RADII_METERS.includes(v as any), {
    message: "wakeRadiusMeters must be 805, 1609, or 3219",
  }).optional(),
  arrivalRadiusFeet: z.number().refine((v) => ALLOWED_ARRIVAL_RADII_FEET.includes(v as any), {
    message: "arrivalRadiusFeet must be 150, 250, 500, or 1000",
  }).optional(),
  departureGraceMinutes: z.number().refine((v) => ALLOWED_DEPARTURE_GRACE_MINUTES.includes(v as any), {
    message: "departureGraceMinutes must be 3, 4, or 5",
  }).optional(),
  arrivalConfirmationSeconds: z.number().refine((v) => ALLOWED_ARRIVAL_CONFIRMATION_SECONDS.includes(v as any), {
    message: "arrivalConfirmationSeconds must be 30, 45, or 60",
  }).optional(),
  manualFallbackEnabled: z.boolean().optional(),
});

// CEO/Admin only.
export async function PATCH(request: Request) {
  try {
    const { supabase, companyId } = await getCompanyId();
    const role = await getEffectiveRole();
    if (role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = await request.json().catch(() => null);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation error", details: parsed.error.flatten() }, { status: 422 });
    }
    const d = parsed.data;
    const update: Record<string, unknown> = {};
    if (d.requireApproval !== undefined) update.jobsite_require_approval = d.requireApproval;
    if (d.wakeRadiusMeters !== undefined) update.jobsite_wake_radius_meters = d.wakeRadiusMeters;
    if (d.arrivalRadiusFeet !== undefined) update.jobsite_geofence_radius_feet = d.arrivalRadiusFeet;
    if (d.departureGraceMinutes !== undefined) update.jobsite_departure_grace_minutes = d.departureGraceMinutes;
    if (d.arrivalConfirmationSeconds !== undefined) update.jobsite_arrival_confirmation_seconds = d.arrivalConfirmationSeconds;
    if (d.manualFallbackEnabled !== undefined) update.jobsite_manual_fallback_enabled = d.manualFallbackEnabled;
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "No settings provided" }, { status: 422 });
    }

    const db = getSupabaseAdmin() ?? supabase;
    const result = await db.from("companies").update(update).eq("id", companyId).select(SETTINGS_COLUMNS).maybeSingle();
    if (result.error) {
      return NextResponse.json({ error: result.error.message }, { status: 400 });
    }
    return NextResponse.json({ item: mapCompanyJobsiteSettings(result.data) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}
