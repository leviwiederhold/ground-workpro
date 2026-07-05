import { NextResponse } from "next/server";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getEffectiveRole } from "@/lib/auth/effectiveRole";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { canManageTimecards, mapTimecard } from "@/lib/jobsite-time/domain";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { supabase, companyId, userId } = await getCompanyId();
    const role = await getEffectiveRole();
    const isManager = canManageTimecards(role);
    const db = getSupabaseAdmin() ?? supabase;

    const url = new URL(request.url);
    const p = url.searchParams;

    let query = db.from("jobsite_timecards").select("*").eq("company_id", companyId);

    // TENANT/ROLE ISOLATION: employees can only ever see their own rows. A
    // manager may pass ?employee to scope to one person.
    if (!isManager) {
      query = query.eq("user_id", userId);
    } else {
      const employee = p.get("employee");
      if (employee) query = query.or(`user_id.eq.${employee},employee_id.eq.${employee}`);
    }

    const jobId = p.get("job");
    if (jobId) query = query.eq("job_id", /^\d+$/.test(jobId) ? Number(jobId) : jobId);

    const status = p.get("status");
    if (status) query = query.eq("status", status);

    const confidence = p.get("confidence");
    if (confidence) query = query.eq("confidence", confidence);

    const src = p.get("source");
    if (src) query = query.eq("source", src);

    const from = p.get("from");
    if (from) query = query.gte("work_date", from);
    const to = p.get("to");
    if (to) query = query.lte("work_date", to);

    if (p.get("needsReview") === "1") query = query.eq("status", "needs_review");
    if (p.get("unapproved") === "1") query = query.in("status", ["active", "pending_review", "needs_review"]);
    if (p.get("approved") === "1") query = query.eq("status", "approved");
    if (p.get("missingClockOut") === "1") query = query.is("clock_out_at", null);

    query = query.order("work_date", { ascending: false }).order("created_at", { ascending: false }).limit(500);

    const result = await query;
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });

    let items = (result.data ?? []).map(mapTimecard);

    // Derived filters (need scheduled window comparison).
    if (p.get("lateArrival") === "1") {
      items = items.filter((t) => t.scheduledStart && t.clockInAt && Date.parse(t.clockInAt) > Date.parse(t.scheduledStart) + 5 * 60000);
    }
    if (p.get("earlyDeparture") === "1") {
      items = items.filter((t) => t.scheduledEnd && t.clockOutAt && Date.parse(t.clockOutAt) < Date.parse(t.scheduledEnd) - 5 * 60000);
    }

    return NextResponse.json({ items, canManage: isManager });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}
