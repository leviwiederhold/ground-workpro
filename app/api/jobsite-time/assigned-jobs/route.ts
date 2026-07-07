/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// The current user's assigned jobs, with verified coordinates when available.
// Used by the field-employee Attendance card / foreground geofence watcher to
// know which job geofences to evaluate — never returns other employees' data.
export async function GET() {
  try {
    const { supabase, companyId, userId } = await getCompanyId();
    const db = getSupabaseAdmin() ?? supabase;

    const employeeResult = await db
      .from("employees")
      .select("id, job_id")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    const employeeId = employeeResult.data?.id ? String(employeeResult.data.id) : null;
    if (!employeeId) {
      return NextResponse.json({ items: [] });
    }

    const jobIds = new Set<string>();
    if (employeeResult.data?.job_id) jobIds.add(String(employeeResult.data.job_id));

    const assignmentsResult = await db
      .from("job_employees")
      .select("job_id")
      .eq("company_id", companyId)
      .eq("employee_id", employeeId)
      .limit(200);
    for (const row of assignmentsResult.data ?? []) {
      if (row.job_id) jobIds.add(String(row.job_id));
    }

    if (jobIds.size === 0) {
      return NextResponse.json({ items: [] });
    }

    const jobsResult = await db
      .from("jobs")
      .select("id, name, lat, lng, address_verified")
      .eq("company_id", companyId)
      .in("id", Array.from(jobIds));
    if (jobsResult.error) return NextResponse.json({ error: jobsResult.error.message }, { status: 400 });

    const items = (jobsResult.data ?? []).map((job: any) => ({
      jobId: String(job.id),
      name: job.name ?? "Job",
      lat: job.lat === null || job.lat === undefined ? null : Number(job.lat),
      lng: job.lng === null || job.lng === undefined ? null : Number(job.lng),
      addressVerified: Boolean(job.address_verified) && job.lat !== null && job.lng !== null,
    }));

    return NextResponse.json({ items });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}
