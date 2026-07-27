import { NextResponse } from "next/server";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveAssignedJobs } from "@/lib/jobsite-time/assignedJobs";

export const dynamic = "force-dynamic";

// The current user's assigned jobs, with verified coordinates when available.
// Used by the field-employee Attendance card / foreground geofence watcher to
// know which job geofences to evaluate — never returns other employees' data.
//
// Assignments are derived from job_employees (the authoritative model, same as
// the native monitoring-plan). Company scoping and the { items } response shape
// are unchanged; authorization is enforced by getCompanyId.
export async function GET() {
  try {
    const { supabase, companyId, userId } = await getCompanyId();
    const db = getSupabaseAdmin() ?? supabase;
    const items = await resolveAssignedJobs(db, companyId, userId);
    return NextResponse.json({ items });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}
