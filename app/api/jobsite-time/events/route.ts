import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  buildCompanyScheduleWindow,
  computeTotalMinutes,
  evaluateJobsiteEvent,
  mapCompanyJobsiteSettings,
  mapTimecard,
} from "@/lib/jobsite-time/domain";
import { resolveCompanyWorkSchedule } from "@/lib/company/companyConfig";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  jobId: z.union([z.string(), z.number()]),
  transition: z.enum(["enter", "exit"]),
  occurredAt: z.string().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  accuracyMeters: z.number().nullable().optional(),
  source: z.enum(["jobsite_auto", "manual"]).optional(),
});

const round4 = (v: number | null | undefined) =>
  v === null || v === undefined ? null : Math.round(v * 10000) / 10000;

const normalizeId = (id: string | number) => (/^\d+$/.test(String(id)) ? Number(id) : id);

export async function POST(request: Request) {
  try {
    const { supabase, companyId, userId } = await getCompanyId();
    const db = getSupabaseAdmin() ?? supabase;

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation error", details: parsed.error.flatten() }, { status: 422 });
    }
    const input = parsed.data;
    const jobId = normalizeId(input.jobId);
    const occurredAt = input.occurredAt && !Number.isNaN(Date.parse(input.occurredAt))
      ? new Date(input.occurredAt).toISOString()
      : new Date().toISOString();
    const source = input.source ?? "jobsite_auto";

    // Company settings — auto events require the feature to be enabled.
    const settingsRow = await db
      .from("companies")
      .select(
        "timezone,default_work_days,default_work_start_time,default_work_end_time,attendance_early_arrival_window_minutes,attendance_late_grace_minutes,jobsite_time_enabled,jobsite_require_approval,jobsite_geofence_radius_feet,jobsite_ignore_short_departure_minutes,jobsite_break_threshold_minutes,jobsite_auto_clockout_after_end,jobsite_manual_fallback_enabled"
      )
      .eq("id", companyId)
      .maybeSingle();
    const settings = mapCompanyJobsiteSettings(settingsRow.data);
    // Null until the company has valid, configured work hours + timezone. When
    // null we never derive a scheduled window or an arrival status.
    const workSchedule = resolveCompanyWorkSchedule(settingsRow.data);
    if (source === "jobsite_auto" && !settings.enabled) {
      return NextResponse.json({ error: "Automatic Jobsite Time is not enabled for this company." }, { status: 403 });
    }

    // Validate job belongs to the company.
    const jobResult = await db
      .from("jobs")
      .select("id, lat, lng")
      .eq("company_id", companyId)
      .eq("id", jobId)
      .maybeSingle();
    if (jobResult.error) return NextResponse.json({ error: jobResult.error.message }, { status: 400 });
    if (!jobResult.data) return NextResponse.json({ error: "Job not found in your company" }, { status: 404 });

    // Resolve the requesting employee within this company.
    const employeeResult = await db
      .from("employees")
      .select("id")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    const employeeId = employeeResult.data?.id ? String(employeeResult.data.id) : null;
    if (!employeeId) {
      return NextResponse.json({ error: "No employee record for this user in the company" }, { status: 403 });
    }

    // Validate the employee is ASSIGNED to the job before accepting auto events.
    const assignmentResult = await db
      .from("job_employees")
      .select("job_id")
      .eq("company_id", companyId)
      .eq("job_id", jobId)
      .eq("employee_id", employeeId)
      .limit(1)
      .maybeSingle();
    if (!assignmentResult.data) {
      return NextResponse.json({ error: "Employee is not assigned to this job" }, { status: 403 });
    }

    const companyWindow = workSchedule ? buildCompanyScheduleWindow(occurredAt, workSchedule) : null;
    // Fall back to a UTC calendar date only for record-keeping when no company
    // schedule/timezone is configured — this does NOT drive attendance status.
    const workDate = companyWindow?.workDate ?? occurredAt.slice(0, 10);

    // Look up the assigned shift window for this day (if the schedule exists).
    let scheduledStart: string | null = companyWindow?.scheduledStart ?? null;
    let scheduledEnd: string | null = companyWindow?.scheduledEnd ?? null;
    let hasSchedule = companyWindow?.hasSchedule ?? false;
    const scheduleResult = await db
      .from("schedule_assignments")
      .select("starts_at, ends_at")
      .eq("company_id", companyId)
      .eq("job_id", jobId)
      .eq("employee_id", employeeId)
      .eq("date", workDate)
      .order("starts_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!scheduleResult.error && scheduleResult.data) {
      hasSchedule = true;
      scheduledStart = scheduleResult.data.starts_at ?? null;
      scheduledEnd = scheduleResult.data.ends_at ?? null;
    }

    // Server-side geofence + schedule-window verification. We do NOT fully trust
    // the native enter/exit — recompute distance from the job's coords, enforce
    // the assigned window, and reject grossly-invalid auto events.
    const evaluation = evaluateJobsiteEvent({
      transition: input.transition,
      occurredAt,
      jobLat: jobResult.data.lat ?? null,
      jobLng: jobResult.data.lng ?? null,
      pointLat: input.latitude ?? null,
      pointLng: input.longitude ?? null,
      accuracyMeters: input.accuracyMeters,
      radiusFeet: settings.geofenceRadiusFeet,
      scheduledStart,
      scheduledEnd,
      hasSchedule,
      // Only pass tuning when the company has valid work hours — this is what
      // gates late/early computation in evaluateJobsiteEvent.
      earlyArrivalWindowMinutes: workSchedule?.earlyArrivalWindowMinutes,
      lateGraceMinutes: workSchedule?.lateGraceMinutes,
    });
    if (evaluation.reject && source === "jobsite_auto") {
      return NextResponse.json({ error: evaluation.reason || "Invalid jobsite event" }, { status: 422 });
    }
    if (evaluation.ignore && source === "jobsite_auto") {
      return NextResponse.json({
        item: null,
        ignored: true,
        reason: evaluation.reason || "Event is outside the company's attendance tracking window",
      });
    }
    const confidence = evaluation.confidence;
    const needsReview = evaluation.needsReview;

    // Find today's open timecard for this employee+job (one per work day).
    const existing = await db
      .from("jobsite_timecards")
      .select("*")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .eq("job_id", jobId)
      .eq("work_date", workDate)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let timecard = existing.data ?? null;
    let eventType: string;

    if (input.transition === "enter") {
      eventType = "auto_clock_in";
      const clockedInStatus = settings.requireApproval ? "pending_review" : "active";
      if (!timecard) {
        const insert = await db
          .from("jobsite_timecards")
          .insert({
            company_id: companyId,
            employee_id: employeeId,
            user_id: userId,
            job_id: jobId,
            work_date: workDate,
            scheduled_start: scheduledStart,
            scheduled_end: scheduledEnd,
            geofence_radius_feet: settings.geofenceRadiusFeet,
            detected_arrival_at: occurredAt,
            arrival_status: evaluation.arrivalStatus,
            clock_in_at: occurredAt,
            status: needsReview ? "needs_review" : clockedInStatus,
            source,
            confidence,
          })
          .select("*")
          .maybeSingle();
        if (insert.error) return NextResponse.json({ error: insert.error.message }, { status: 400 });
        timecard = insert.data;
      } else if (!timecard.clock_in_at) {
        const upd = await db
          .from("jobsite_timecards")
          .update({ detected_arrival_at: occurredAt, arrival_status: evaluation.arrivalStatus, clock_in_at: occurredAt, confidence })
          .eq("id", timecard.id)
          .eq("company_id", companyId)
          .select("*")
          .maybeSingle();
        if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 400 });
        timecard = upd.data;
      }
    } else {
      // exit
      eventType = "auto_clock_out";
      if (!timecard) {
        return NextResponse.json({ error: "No open jobsite time to close" }, { status: 409 });
      }
      const scheduledEndMs = timecard.scheduled_end ? Date.parse(timecard.scheduled_end) : NaN;
      const pastScheduledEnd = Number.isFinite(scheduledEndMs) && Date.parse(occurredAt) >= scheduledEndMs;
      // Auto clock-out after leaving past scheduled end (or when no schedule is
      // known). Otherwise flag for review as a possible break/short departure.
      const shouldClockOut = settings.autoClockOutAfterEnd && (pastScheduledEnd || !Number.isFinite(scheduledEndMs));
      const nextRow: Record<string, unknown> = { detected_departure_at: occurredAt, confidence };
      if (shouldClockOut) {
        nextRow.clock_out_at = occurredAt;
        nextRow.total_minutes = computeTotalMinutes({ ...timecard, clock_out_at: occurredAt });
        nextRow.status = needsReview ? "needs_review" : settings.requireApproval ? "pending_review" : "active";
      } else {
        // Short/questionable departure — flag as a possible break for review.
        nextRow.status = "needs_review";
        eventType = "break_suggested";
      }
      const upd = await db
        .from("jobsite_timecards")
        .update(nextRow)
        .eq("id", timecard.id)
        .eq("company_id", companyId)
        .select("*")
        .maybeSingle();
      if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 400 });
      timecard = upd.data;
    }

    // Append the audit event (coarse coords only; never a trail).
    await db.from("jobsite_timecard_events").insert({
      company_id: companyId,
      timecard_id: timecard?.id ?? null,
      event_type: input.transition === "enter" ? "entered_geofence" : "exited_geofence",
      occurred_at: occurredAt,
      job_id: jobId,
      employee_id: employeeId,
      user_id: userId,
      latitude: round4(input.latitude),
      longitude: round4(input.longitude),
      accuracy_meters: input.accuracyMeters ?? null,
      source,
    });
    // Also record the derived auto action for the timeline.
    await db.from("jobsite_timecard_events").insert({
      company_id: companyId,
      timecard_id: timecard?.id ?? null,
      event_type: eventType,
      occurred_at: occurredAt,
      job_id: jobId,
      employee_id: employeeId,
      user_id: userId,
      source,
    });

    return NextResponse.json({ item: timecard ? mapTimecard(timecard) : null });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unexpected server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
