import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  buildCompanyScheduleWindow,
  evaluateJobsiteEvent,
  mapCompanyJobsiteSettings,
  mapTimecard,
} from "@/lib/jobsite-time/domain";
import { resolveCompanyWorkSchedule, type CompanyConfigRow } from "@/lib/company/companyConfig";
import { finalizePendingAttendance } from "@/lib/jobsite-time/finalizeAttendance";

export const dynamic = "force-dynamic";

// #51 two-zone/pending-attendance columns + #52 company work-schedule columns.
// Both mappers below read from this single row: mapCompanyJobsiteSettings (the
// geofence/pending engine) and resolveCompanyWorkSchedule (company work hours).
const SETTINGS_COLUMNS =
  "jobsite_time_enabled,jobsite_require_approval,jobsite_geofence_radius_feet,jobsite_wake_radius_meters,jobsite_departure_grace_minutes,jobsite_arrival_confirmation_seconds,jobsite_manual_fallback_enabled" +
  ",timezone,default_work_days,default_work_start_time,default_work_end_time,attendance_early_arrival_window_minutes,attendance_late_grace_minutes";

const bodySchema = z.object({
  jobId: z.union([z.string(), z.number()]),
  // Which geofence fired. "wake" only starts closer monitoring; only "arrival"
  // (the default, for backward compatibility with older native payloads) can
  // create/update a timecard.
  zone: z.enum(["wake", "arrival"]).default("arrival"),
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
    const settingsRow = await db.from("companies").select(SETTINGS_COLUMNS).eq("id", companyId).maybeSingle();
    const settings = mapCompanyJobsiteSettings(settingsRow.data);
    // Null until the company has valid, configured work hours + timezone. When
    // null we never derive a company scheduled window or an arrival status.
    const workSchedule = resolveCompanyWorkSchedule(settingsRow.data as unknown as CompanyConfigRow | null);
    // Attendance is permanent — auto events are never rejected on an
    // enable/disable gate.

    // Validate job belongs to the company AND has a verified address. Attendance
    // must never silently fall back to fake/default coordinates.
    const jobResult = await db
      .from("jobs")
      .select("id, lat, lng, address_verified")
      .eq("company_id", companyId)
      .eq("id", jobId)
      .maybeSingle();
    if (jobResult.error) return NextResponse.json({ error: jobResult.error.message }, { status: 400 });
    if (!jobResult.data) return NextResponse.json({ error: "Job not found in your company" }, { status: 404 });

    // The verified-address requirement only gates AUTOMATIC tracking — manual
    // clock-in/out must keep working as a fallback even at a job whose address
    // hasn't been verified yet.
    const hasVerifiedCoords =
      Boolean(jobResult.data.address_verified) && jobResult.data.lat !== null && jobResult.data.lng !== null;
    if (!hasVerifiedCoords && source === "jobsite_auto") {
      return NextResponse.json(
        { error: "Address needs verification", code: "address_unverified" },
        { status: 422 }
      );
    }

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

    // Attendance only counts for jobs the employee is ASSIGNED to. An auto
    // event at an unassigned job is ignored (not an error) rather than
    // silently clocking anyone in.
    const assignmentResult = await db
      .from("job_employees")
      .select("job_id")
      .eq("company_id", companyId)
      .eq("job_id", jobId)
      .eq("employee_id", employeeId)
      .limit(1)
      .maybeSingle();
    if (!assignmentResult.data) {
      if (source === "jobsite_auto") {
        return NextResponse.json({ ignored: true, reason: "not_assigned" });
      }
      return NextResponse.json({ error: "Employee is not assigned to this job" }, { status: 403 });
    }

    // Wake zone only wakes closer monitoring — it never creates/updates a
    // timecard by itself, so skip the (company-wide) pending-attendance sweep
    // for it entirely.
    if (input.zone === "wake") {
      return NextResponse.json({ ok: true, zone: "wake" });
    }

    await finalizePendingAttendance({
      db,
      companyId,
      arrivalConfirmationSeconds: settings.arrivalConfirmationSeconds,
      departureGraceMinutes: settings.departureGraceMinutes,
    });

    // Prefer the company-local work date (from configured timezone) so a late
    // shift never rolls onto the wrong UTC day; fall back to a UTC calendar
    // date only when no company schedule/timezone is configured.
    const companyWindow = workSchedule ? buildCompanyScheduleWindow(occurredAt, workSchedule) : null;
    const workDate = companyWindow?.workDate ?? occurredAt.slice(0, 10);

    // Scheduled window: seed from the company work hours (when configured), then
    // let a more-specific per-day shift assignment override it.
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

    // Server-side geofence + schedule-window verification against the ARRIVAL
    // (small) radius. We do NOT fully trust the native enter/exit — recompute
    // distance from the job's coords, enforce the assigned window, and reject
    // grossly-invalid auto events. Company work-hour tuning is only passed when
    // valid work hours exist, which is what gates late/early computation.
    const evaluation = evaluateJobsiteEvent({
      transition: input.transition,
      occurredAt,
      jobLat: jobResult.data.lat ?? null,
      jobLng: jobResult.data.lng ?? null,
      pointLat: input.latitude ?? null,
      pointLng: input.longitude ?? null,
      accuracyMeters: input.accuracyMeters,
      radiusFeet: settings.arrivalRadiusFeet,
      scheduledStart,
      scheduledEnd,
      hasSchedule,
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

    // Find today's timecard for this employee+job (one per work day).
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

    if (input.transition === "enter") {
      // If the employee arrived somewhere new while another assigned job was
      // still open (or awaiting arrival confirmation) today, that's an
      // unambiguous signal they left/never really stopped at the first one —
      // resolve it rather than double-counting hours at two jobs (section 4:
      // avoid double clock-in / handle Job A → Job B moves).
      const otherOpen = await db
        .from("jobsite_timecards")
        .select("*")
        .eq("company_id", companyId)
        .eq("user_id", userId)
        .eq("work_date", workDate)
        .not("job_id", "eq", jobId)
        .is("clock_out_at", null)
        .limit(5);
      for (const other of otherOpen.data ?? []) {
        if (!other.clock_in_at) {
          // Never actually confirmed arrived — cancel the pending arrival.
          if (other.pending_arrival_at) {
            await db
              .from("jobsite_timecards")
              .update({ pending_arrival_at: null })
              .eq("id", other.id)
              .eq("company_id", companyId);
          }
          continue;
        }
        if (other.pending_departure_at) continue; // already leaving; let it finalize normally
        await db
          .from("jobsite_timecards")
          .update({ pending_departure_at: occurredAt, detected_departure_at: occurredAt })
          .eq("id", other.id)
          .eq("company_id", companyId);
        await db.from("jobsite_timecard_events").insert({
          company_id: companyId,
          timecard_id: other.id,
          event_type: "exited_geofence",
          occurred_at: occurredAt,
          job_id: other.job_id,
          employee_id: employeeId,
          user_id: userId,
          source,
          notes: "Employee arrived at another assigned job",
        });
      }

      const clockedInStatus = settings.requireApproval ? "pending_review" : "active";
      // No open timecard for this job today, OR the last one for today is
      // already fully closed (e.g. a lunch break that finalized past the
      // departure grace period) — start a new session rather than treating
      // this as a no-op, so returning to the same job later the same day is
      // still detected.
      if (!timecard || (timecard.clock_in_at && timecard.clock_out_at)) {
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
            geofence_radius_feet: settings.arrivalRadiusFeet,
            pending_arrival_at: occurredAt,
            arrival_status: evaluation.arrivalStatus,
            status: needsReview ? "needs_review" : clockedInStatus,
            source,
            confidence,
          })
          .select("*")
          .maybeSingle();
        if (insert.error) return NextResponse.json({ error: insert.error.message }, { status: 400 });
        timecard = insert.data;
      } else if (timecard.clock_in_at && timecard.pending_departure_at) {
        // Re-entry before the departure grace period elapsed — cancel it.
        const upd = await db
          .from("jobsite_timecards")
          .update({ pending_departure_at: null })
          .eq("id", timecard.id)
          .eq("company_id", companyId)
          .select("*")
          .maybeSingle();
        if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 400 });
        timecard = upd.data;
      } else if (!timecard.clock_in_at) {
        const upd = await db
          .from("jobsite_timecards")
          .update({
            pending_arrival_at: timecard.pending_arrival_at ?? occurredAt,
            arrival_status: evaluation.arrivalStatus,
            confidence,
          })
          .eq("id", timecard.id)
          .eq("company_id", companyId)
          .select("*")
          .maybeSingle();
        if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 400 });
        timecard = upd.data;
      }
      // Otherwise: already checked in with no pending departure — duplicate
      // enter, nothing to do.

      await db.from("jobsite_timecard_events").insert({
        company_id: companyId,
        timecard_id: timecard?.id ?? null,
        event_type: "entered_geofence",
        occurred_at: occurredAt,
        job_id: jobId,
        employee_id: employeeId,
        user_id: userId,
        latitude: round4(input.latitude),
        longitude: round4(input.longitude),
        accuracy_meters: input.accuracyMeters ?? null,
        source,
      });
    } else {
      // exit
      if (!timecard) {
        if (source === "jobsite_auto") {
          return NextResponse.json({ ignored: true, reason: "no_open_timecard" });
        }
        return NextResponse.json({ error: "No open jobsite time to close" }, { status: 409 });
      }

      if (!timecard.clock_in_at && timecard.pending_arrival_at) {
        // Left before the arrival confirmation delay elapsed — cancel it.
        const upd = await db
          .from("jobsite_timecards")
          .update({ pending_arrival_at: null })
          .eq("id", timecard.id)
          .eq("company_id", companyId)
          .select("*")
          .maybeSingle();
        if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 400 });
        timecard = upd.data;
      } else if (timecard.clock_in_at && !timecard.clock_out_at) {
        const upd = await db
          .from("jobsite_timecards")
          .update({
            pending_departure_at: timecard.pending_departure_at ?? occurredAt,
            detected_departure_at: occurredAt,
            confidence,
            status: needsReview ? "needs_review" : timecard.status,
          })
          .eq("id", timecard.id)
          .eq("company_id", companyId)
          .select("*")
          .maybeSingle();
        if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 400 });
        timecard = upd.data;
      }

      await db.from("jobsite_timecard_events").insert({
        company_id: companyId,
        timecard_id: timecard?.id ?? null,
        event_type: "exited_geofence",
        occurred_at: occurredAt,
        job_id: jobId,
        employee_id: employeeId,
        user_id: userId,
        latitude: round4(input.latitude),
        longitude: round4(input.longitude),
        accuracy_meters: input.accuracyMeters ?? null,
        source,
      });
    }

    return NextResponse.json({ item: timecard ? mapTimecard(timecard) : null });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unexpected server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
