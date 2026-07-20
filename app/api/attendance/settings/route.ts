import { NextResponse } from "next/server";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getEffectiveRole } from "@/lib/auth/effectiveRole";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  ATTENDANCE_SETTINGS_COLUMNS,
  DEFAULT_AUTOMATIC_ATTENDANCE_SETTINGS,
  buildAttendanceSettingsUpdate,
  mapRowToAttendanceSettings,
  validateAttendanceSettingsPatch,
} from "@/lib/attendance/attendanceSettings";

export const dynamic = "force-dynamic";

const isMissingColumn = (message: string | undefined) =>
  /column|Could not find the/i.test(String(message || "")) && /does not exist|not find/i.test(String(message || ""));

// Any company member may READ the settings (server + native clients consume the
// same values). Falls back to documented defaults if the migration hasn't run.
export async function GET() {
  try {
    const { supabase, companyId } = await getCompanyId();
    const db = getSupabaseAdmin() ?? supabase;
    const result = await db.from("companies").select(ATTENDANCE_SETTINGS_COLUMNS).eq("id", companyId).maybeSingle();
    if (result.error) {
      if (isMissingColumn(result.error.message)) {
        return NextResponse.json({ item: DEFAULT_AUTOMATIC_ATTENDANCE_SETTINGS });
      }
      return NextResponse.json({ error: result.error.message }, { status: 400 });
    }
    return NextResponse.json({ item: mapRowToAttendanceSettings(result.data as Record<string, unknown> | null) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}

// CEO/Admin only. Invalid values are rejected (422), never silently clamped.
export async function PATCH(request: Request) {
  try {
    const { supabase, companyId } = await getCompanyId();
    const role = await getEffectiveRole();
    if (role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const validation = validateAttendanceSettingsPatch(await request.json().catch(() => null));
    if (!validation.ok) {
      return NextResponse.json({ error: "Validation error", details: validation.errors }, { status: 422 });
    }

    const update = buildAttendanceSettingsUpdate(validation.value);
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "No settings provided" }, { status: 422 });
    }

    const db = getSupabaseAdmin() ?? supabase;
    const result = await db
      .from("companies")
      .update(update)
      .eq("id", companyId)
      .select(ATTENDANCE_SETTINGS_COLUMNS)
      .maybeSingle();
    if (result.error) {
      return NextResponse.json({ error: result.error.message }, { status: 400 });
    }
    return NextResponse.json({ item: mapRowToAttendanceSettings(result.data as Record<string, unknown> | null) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}
