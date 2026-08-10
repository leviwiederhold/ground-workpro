// What this employee's device should be monitoring, and when.
//
// Geofence registration happens on the client, but WHETHER to monitor is a
// server decision based on assignment and the company schedule. A clock-out
// closes one session; it does not end monitoring for the workday.

import { NextResponse } from "next/server";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  ATTENDANCE_UNAVAILABLE_MESSAGE,
  getAttendanceWriteDb,
} from "@/lib/attendance/attendanceDb";
import { verifyAttendanceCredential } from "@/lib/attendance/deviceCredentialServer";
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

export async function GET(request: Request) {
  try {
    // Headless iOS launches have no WebView cookies. Resolve the same restricted
    // device bearer used for native events; browser callers keep the existing
    // session path.
    const hasBearer = /^Bearer\s+/i.test(request.headers.get("authorization") ?? "");
    let companyId: string;
    let userId: string;
    let db;
    if (hasBearer) {
      db = getAttendanceWriteDb("GET /api/attendance/monitoring-plan");
      if (!db) {
        return NextResponse.json({ error: ATTENDANCE_UNAVAILABLE_MESSAGE }, { status: 503 });
      }
      const credential = await verifyAttendanceCredential(db, request);
      if (!credential) {
        return NextResponse.json(
          { error: "Invalid or expired attendance credential" },
          { status: 401 },
        );
      }
      companyId = credential.companyId;
      userId = credential.userId;
    } else {
      const session = await getCompanyId();
      db = getSupabaseAdmin() ?? session.supabase;
      companyId = session.companyId;
      userId = session.userId;
    }

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

    const days: MonitoringDay[] = horizon.map((workDate) => {
      const window = workSchedule
        ? scheduledWindowForWorkDate(workDate, workSchedule)
        : { scheduledStart: null, scheduledEnd: null, isWorkDay: false };
      return {
        workDate,
        scheduledStart: window.scheduledStart,
        scheduledEnd: window.scheduledEnd,
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

    // Keep the fixed assigned regions registered across nights and days. Region
    // monitoring is discrete and low-power; the server still applies the work
    // schedule to every transition. Clearing regions after the cutoff would
    // require a guaranteed time-based background launch to restore them the
    // next morning, and iOS deliberately offers no such guarantee.
    const arrivalRadiusFeet = Number(
      (settingsRow.data as Record<string, unknown> | null)?.jobsite_geofence_radius_feet ??
        DEFAULT_ARRIVAL_RADIUS_FEET
    );
    const wakeRadiusMeters = Number(
      (settingsRow.data as Record<string, unknown> | null)?.jobsite_wake_radius_meters ??
        DEFAULT_WAKE_RADIUS_METERS
    );
    const regions = hasMonitorableJob && assignedJob
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
