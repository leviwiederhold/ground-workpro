import { NextResponse } from "next/server";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getEffectiveRole } from "@/lib/auth/effectiveRole";
import {
  ATTENDANCE_UNAVAILABLE_MESSAGE,
  AttendanceWriteError,
  getAttendanceWriteDb,
} from "@/lib/attendance/attendanceDb";
import { canManageTimecards, mapCompanyJobsiteSettings, mapTimecard } from "@/lib/jobsite-time/domain";
import { finalizePendingAttendance } from "@/lib/jobsite-time/finalizeAttendance";

export const dynamic = "force-dynamic";

// This GET is not a pure read: it finalizes pending arrivals and departures
// before returning the list.
//
// It therefore REFUSES TO RETURN DATA when finalization cannot run, rather than
// serving whatever is currently in the table. That is deliberate. The unfinalized
// rows are wrong in a specific and dangerous way — an employee who left hours ago
// still reads as clocked in, and the hours shown are the hours a manager would
// approve. A 503 tells the caller attendance is unavailable; a 200 with stale rows
// tells them nothing is wrong. Between an outage and silently incorrect payroll,
// this endpoint chooses the outage.
export async function GET(request: Request) {
  try {
    const { companyId, userId } = await getCompanyId();
    const role = await getEffectiveRole();
    const isManager = canManageTimecards(role);
    // This GET writes: it finalizes pending arrivals/departures before reading.
    // Serving the list without that pass would show stale state — someone still
    // "clocked in" who should have been clocked out — so a write-capable client
    // is required even though the caller only asked to read.
    const db = getAttendanceWriteDb("GET /api/jobsite-time/timecards");
    if (!db) {
      return NextResponse.json({ error: ATTENDANCE_UNAVAILABLE_MESSAGE }, { status: 503 });
    }

    const settingsRow = await db
      .from("companies")
      .select("jobsite_time_enabled,jobsite_arrival_confirmation_seconds,jobsite_departure_grace_minutes")
      .eq("id", companyId)
      .maybeSingle();
    const settings = mapCompanyJobsiteSettings(settingsRow.data);
    // Attendance is permanent — always finalize pending arrivals/departures.
    await finalizePendingAttendance({
      db,
      companyId,
      arrivalConfirmationSeconds: settings.arrivalConfirmationSeconds,
      departureGraceMinutes: settings.departureGraceMinutes,
    });

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
      items = items.filter((t) => t.arrivalStatus === "late");
    }
    if (p.get("earlyDeparture") === "1") {
      items = items.filter((t) => t.scheduledEnd && t.clockOutAt && Date.parse(t.clockOutAt) < Date.parse(t.scheduledEnd) - 5 * 60000);
    }

    return NextResponse.json({ items, canManage: isManager });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    // Finalization failed, so the list would show state that is known to be
    // stale. Refusing beats serving hours that are wrong but look authoritative.
    if (error instanceof AttendanceWriteError) {
      return NextResponse.json({ error: ATTENDANCE_UNAVAILABLE_MESSAGE }, { status: 503 });
    }
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}
