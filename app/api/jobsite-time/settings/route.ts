/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getEffectiveRole } from "@/lib/auth/effectiveRole";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  ALLOWED_GEOFENCE_RADII_FEET,
  DEFAULT_JOBSITE_TIME_SETTINGS,
  mapCompanyJobsiteSettings,
} from "@/lib/jobsite-time/domain";

export const dynamic = "force-dynamic";

const SETTINGS_COLUMNS =
  "jobsite_time_enabled,jobsite_require_approval,jobsite_geofence_radius_feet,jobsite_ignore_short_departure_minutes,jobsite_break_threshold_minutes,jobsite_auto_clockout_after_end,jobsite_manual_fallback_enabled";

const isMissingColumn = (message: string | undefined) =>
  /column|Could not find the/i.test(String(message || "")) && /does not exist|not find/i.test(String(message || ""));

// Any company member may READ settings (the employee UI needs to know whether
// Automatic Jobsite Time is on and the manual fallback is available).
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

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  requireApproval: z.boolean().optional(),
  geofenceRadiusFeet: z.number().refine((v) => ALLOWED_GEOFENCE_RADII_FEET.includes(v as any), {
    message: "geofenceRadiusFeet must be 250, 500, or 750",
  }).optional(),
  ignoreShortDepartureMinutes: z.number().int().min(0).max(120).optional(),
  breakThresholdMinutes: z.number().int().min(0).max(240).optional(),
  autoClockOutAfterEnd: z.boolean().optional(),
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
    if (d.enabled !== undefined) update.jobsite_time_enabled = d.enabled;
    if (d.requireApproval !== undefined) update.jobsite_require_approval = d.requireApproval;
    if (d.geofenceRadiusFeet !== undefined) update.jobsite_geofence_radius_feet = d.geofenceRadiusFeet;
    if (d.ignoreShortDepartureMinutes !== undefined) update.jobsite_ignore_short_departure_minutes = d.ignoreShortDepartureMinutes;
    if (d.breakThresholdMinutes !== undefined) update.jobsite_break_threshold_minutes = d.breakThresholdMinutes;
    if (d.autoClockOutAfterEnd !== undefined) update.jobsite_auto_clockout_after_end = d.autoClockOutAfterEnd;
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
