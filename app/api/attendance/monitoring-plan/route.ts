// What this employee's device should be monitoring, and when.
//
// Geofence registration happens on the client, but WHETHER to monitor is a
// server decision — it depends on the assignment, the schedule, and whether the
// workday has already been resolved by a clock-out. Serving it from one place
// means the native layer, the employee UI, and diagnostics cannot disagree.
//
// Two rules this exists to enforce, both from the departure lifecycle:
//   - monitoring STOPS for a workday once it is clocked out (otherwise the
//     regions stay registered and re-trigger arrivals for a finished shift);
//   - the NEXT scheduled workday is still prepared, so tomorrow activates
//     normally without the app ever being opened.

import { NextResponse } from "next/server";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveCompanyWorkSchedule, type CompanyConfigRow } from "@/lib/company/companyConfig";
import {
  buildJobsiteRegions,
} from "@/lib/attendance/nativeGeofence";
import { mapRowToAttendanceSettings } from "@/lib/attendance/attendanceSettings";
import { computeMonitoringPlan, type MonitoringDay } from "@/lib/attendance/monitoringPlan";
import {
  feetToMeters,
  getCompanyLocalDateKey,
  scheduledWindowForWorkDate,
  DEFAULT_ARRIVAL_RADIUS_FEET,
  DEFAULT_WAKE_RADIUS_METERS,
} from "@/lib/jobsite-time/domain";

export const dynamic = "force-dynamic";

const SETTINGS_COLUMNS =
  "timezone,default_work_days,default_work_start_time,default_work_end_time," +
  "attendance_automatic_enabled,attendance_early_arrival_window_minutes," +
  "attendance_end_of_day_cutoff_minutes,attendance_geofence_radius_meters," +
  "attendance_late_grace_minutes,jobsite_geofence_radius_feet,jobsite_wake_radius_meters";

// How many days ahead to prepare. Two is enough to cover "today is finished,
// here is tomorrow" across a weekend boundary without a large scan.
const HORIZON_DAYS = 3;

function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export async function GET() {
  try {
    const session = await getCompanyId();
    const db = getSupabaseAdmin() ?? session.supabase;
    const { companyId, userId } = session;

    const settingsRow = await db.from("companies").select(SETTINGS_COLUMNS).eq("id", companyId).maybeSingle();
    const settings = mapRowToAttendanceSettings(settingsRow.data as unknown as Record<string, unknown> | null);
    const workSchedule = resolveCompanyWorkSchedule(settingsRow.data as unknown as CompanyConfigRow | null);

    const employee = await db
      .from("employees")
      .select("id")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    const employeeId = employee.data?.id ? String(employee.data.id) : null;

    const now = new Date().toISOString();
    const today = workSchedule ? getCompanyLocalDateKey(now, workSchedule.timezone) : now.slice(0, 10);
    const horizon = Array.from({ length: HORIZON_DAYS }, (_, i) => addDays(today, i));

    // The assigned job. Automatic attendance requires verified coordinates —
    // an unverified address must never be silently monitored.
    let assignedJob: { jobId: string; lat: number | null; lng: number | null; addressVerified: boolean } | null =
      null;
    if (employeeId) {
      const assignment = await db
        .from("job_employees")
        .select("job_id")
        .eq("company_id", companyId)
        .eq("employee_id", employeeId)
        .limit(1)
        .maybeSingle();
      const jobId = assignment.data?.job_id ?? null;
      if (jobId) {
        const job = await db
          .from("jobs")
          .select("id, lat, lng, address_verified")
          .eq("company_id", companyId)
          .eq("id", jobId)
          .maybeSingle();
        if (job.data) {
          assignedJob = {
            jobId: String(job.data.id),
            lat: job.data.lat ?? null,
            lng: job.data.lng ?? null,
            addressVerified: Boolean(job.data.address_verified),
          };
        }
      }
    }

    // Which of those days are already resolved (clocked out) for this job.
    const resolvedDates = new Set<string>();
    if (assignedJob) {
      const cards = await db
        .from("jobsite_timecards")
        .select("work_date, clock_out_at")
        .eq("company_id", companyId)
        .eq("user_id", userId)
        .eq("job_id", assignedJob.jobId)
        .in("work_date", horizon)
        .not("clock_out_at", "is", null)
        .limit(20);
      for (const card of (cards.data ?? []) as Array<{ work_date: string | null }>) {
        if (card.work_date) resolvedDates.add(card.work_date);
      }
    }

    const days: MonitoringDay[] = horizon.map((workDate) => {
      const window = workSchedule
        ? scheduledWindowForWorkDate(workDate, workSchedule)
        : { scheduledStart: null, scheduledEnd: null, isWorkDay: false };
      return {
        workDate,
        scheduledStart: window.scheduledStart,
        scheduledEnd: window.scheduledEnd,
        resolved: resolvedDates.has(workDate),
      };
    });

    const hasMonitorableJob =
      settings.automaticAttendanceEnabled &&
      Boolean(assignedJob?.addressVerified) &&
      assignedJob?.lat !== null &&
      assignedJob?.lng !== null;

    const plan = computeMonitoringPlan({
      now,
      days,
      monitoringLeadMinutes: settings.monitoringLeadMinutes,
      endOfDayCutoffMinutes: settings.endOfDayCutoffMinutes,
      hasMonitorableJob: Boolean(hasMonitorableJob),
    });

    // Regions are only returned while the plan is active. An inactive plan
    // returns an EMPTY set, which is the instruction to deregister — that is
    // how monitoring stops for a resolved workday.
    const arrivalRadiusFeet = Number(
      (settingsRow.data as Record<string, unknown> | null)?.jobsite_geofence_radius_feet ??
        DEFAULT_ARRIVAL_RADIUS_FEET
    );
    const wakeRadiusMeters = Number(
      (settingsRow.data as Record<string, unknown> | null)?.jobsite_wake_radius_meters ??
        DEFAULT_WAKE_RADIUS_METERS
    );
    const regions =
      plan.active && assignedJob
        ? buildJobsiteRegions(assignedJob, feetToMeters(arrivalRadiusFeet), wakeRadiusMeters)
        : [];

    return NextResponse.json({
      plan,
      regions,
      automaticAttendanceEnabled: settings.automaticAttendanceEnabled,
      hasAssignment: Boolean(assignedJob),
      hasVerifiedCoordinates: Boolean(hasMonitorableJob),
      capturedAt: now,
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unexpected server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
