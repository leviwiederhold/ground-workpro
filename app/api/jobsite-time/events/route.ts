// Geofence transition ingestion.
//
// TRANSPORT ONLY. This route authenticates, validates, loads the rows the
// decision needs, and returns the answer. It contains no attendance rules —
// those live in decideGeofenceEvent(), and the writes live in
// applyGeofenceDecision(). If you find yourself adding an `if` about arrivals,
// departures, or transfers here, it belongs in the engine.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import {
  ATTENDANCE_UNAVAILABLE_MESSAGE,
  AttendanceWriteError,
  getAttendanceWriteDb,
} from "@/lib/attendance/attendanceDb";
import {
  buildCompanyScheduleWindow,
  evaluateJobsiteEvent,
  mapCompanyJobsiteSettings,
  mapTimecard,
} from "@/lib/jobsite-time/domain";
import { resolveCompanyWorkSchedule, type CompanyConfigRow } from "@/lib/company/companyConfig";
import { finalizePendingAttendance } from "@/lib/jobsite-time/finalizeAttendance";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { buildIdempotencyKey, validateEventTimestamp } from "@/lib/attendance/deviceCredential";
import { verifyAttendanceCredential } from "@/lib/attendance/deviceCredentialServer";
import {
  mapRowToAttendanceSettings,
  resolveArrivalConfirmationSeconds,
  resolveDepartureGraceMinutes,
} from "@/lib/attendance/attendanceSettings";
import { decideGeofenceEvent, type GeofenceCard, type OtherOpenCard } from "@/lib/attendance/geofenceEvent";
import { applyGeofenceDecision } from "@/lib/attendance/geofenceEventRunner";

export const dynamic = "force-dynamic";

// #51 two-zone/pending-attendance columns + #52 company work-schedule columns.
// Both mappers below read from this single row: mapCompanyJobsiteSettings (the
// geofence/pending engine) and resolveCompanyWorkSchedule (company work hours).
// #59 automatic-attendance columns are read from the same row by
// mapRowToAttendanceSettings (early-arrival mode + arrival dwell), which is what
// decides whether an early arrival is held until the scheduled start.
const SETTINGS_COLUMNS =
  "jobsite_time_enabled,jobsite_require_approval,jobsite_geofence_radius_feet,jobsite_wake_radius_meters,jobsite_departure_grace_minutes,jobsite_arrival_confirmation_seconds,jobsite_manual_fallback_enabled" +
  ",timezone,default_work_days,default_work_start_time,default_work_end_time,attendance_early_arrival_window_minutes,attendance_late_grace_minutes" +
  ",attendance_automatic_enabled,attendance_arrival_dwell_minutes,attendance_early_arrival_mode" +
  ",attendance_departure_grace_minutes,attendance_end_of_day_cutoff_minutes";

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

const normalizeId = (id: string | number) => (/^\d+$/.test(String(id)) ? Number(id) : id);

// An event that reaches the server this long after it happened came out of the
// offline queue, not off a live transition.
const OFFLINE_SYNC_THRESHOLD_MS = 2 * 60 * 1000;

/* eslint-disable @typescript-eslint/no-explicit-any */
function toGeofenceCard(row: any | null): GeofenceCard | null {
  if (!row) return null;
  return {
    id: String(row.id),
    jobId: row.job_id === null || row.job_id === undefined ? null : String(row.job_id),
    status: row.status ?? null,
    clockInAt: row.clock_in_at ?? null,
    clockOutAt: row.clock_out_at ?? null,
    pendingArrivalAt: row.pending_arrival_at ?? null,
    pendingDepartureAt: row.pending_departure_at ?? null,
    detectedDepartureAt: row.detected_departure_at ?? null,
  };
}

function toOtherOpenCard(row: any): OtherOpenCard {
  return {
    id: String(row.id),
    jobId: row.job_id === null || row.job_id === undefined ? null : String(row.job_id),
    clockInAt: row.clock_in_at ?? null,
    pendingArrivalAt: row.pending_arrival_at ?? null,
    pendingDepartureAt: row.pending_departure_at ?? null,
  };
}

export async function POST(request: Request) {
  let inFlightAudit: { db: any; id: string } | null = null;
  try {
    // ── Authenticate ────────────────────────────────────────────────────────
    // Attendance tables are SELECT-only for authenticated users, so every write
    // here needs the service-role client. There is no session-client fallback:
    // without this the route would accept an arrival and record nothing.
    const db = getAttendanceWriteDb("POST /api/jobsite-time/events");
    if (!db) {
      return NextResponse.json({ error: ATTENDANCE_UNAVAILABLE_MESSAGE }, { status: 503 });
    }

    // Identity resolves from EITHER a device attendance credential (native
    // background POST, no cookies) OR the WebView session cookie (foreground).
    const tokenCtx = await verifyAttendanceCredential(db, request);

    let companyId: string;
    let userId: string;
    let viaToken = false;
    let credentialId: string | null = null;
    let deviceId: string | null = null;

    if (tokenCtx) {
      companyId = tokenCtx.companyId;
      userId = tokenCtx.userId;
      viaToken = true;
      credentialId = tokenCtx.credentialId;
      deviceId = tokenCtx.deviceId;
    } else {
      // Reject a malformed/expired bearer rather than silently trying cookies.
      const hasBearer = /^Bearer\s+/i.test(request.headers.get("authorization") ?? "");
      if (hasBearer) {
        return NextResponse.json({ error: "Invalid or expired attendance credential" }, { status: 401 });
      }
      const session = await getCompanyId();
      companyId = session.companyId;
      userId = session.userId;
    }

    // ── Validate ────────────────────────────────────────────────────────────
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
    const receivedAt = new Date().toISOString();
    // Provenance for the audit trail. The distinction that matters in a dispute
    // is "did this come from the phone in the background, or from a page load?"
    // — and whether it sat in the offline queue before arriving.
    const delayedMs = Date.parse(receivedAt) - Date.parse(occurredAt);
    const eventSource = source === "manual"
      ? "employee_manual"
      : viaToken
        ? (delayedMs > OFFLINE_SYNC_THRESHOLD_MS ? "offline_sync" : "native_geofence")
        : (delayedMs > OFFLINE_SYNC_THRESHOLD_MS ? "offline_sync" : "foreground_reconciliation");
    const provenance = {
      event_source: eventSource,
      device_reported_at: occurredAt,
      server_received_at: receivedAt,
    };

    // Background (token) path hardening: per-credential rate limit, timestamp
    // validation, and idempotency + audit. The audit row's unique idempotency
    // key dedupes duplicate native deliveries of the same transition.
    if (viaToken && credentialId) {
      const rl = enforceRateLimit(request, {
        keyPrefix: `attendance-events:${credentialId}`,
        limit: 60,
        windowMs: 60_000,
      });
      if (rl) return rl;

      const ts = validateEventTimestamp(occurredAt);
      if (!ts.ok) {
        return NextResponse.json({ error: "Invalid event timestamp", reason: ts.reason }, { status: 422 });
      }

      const idempotencyKey = buildIdempotencyKey({
        credentialId,
        jobId,
        zone: input.zone,
        transition: input.transition,
        occurredAt,
      });
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
      let recoveredAuditId: string | null = null;
      const audit = await db
        .from("attendance_event_audit")
        .insert({
          credential_id: credentialId,
          company_id: companyId,
          user_id: userId,
          device_id: deviceId,
          job_id: String(jobId),
          zone: input.zone,
          transition: input.transition,
          occurred_at: occurredAt,
          idempotency_key: idempotencyKey,
          result: "processing",
          response_status: 0,
          ip,
        })
        .select("id")
        .maybeSingle();
      if (audit.error) {
        if (/duplicate key|unique/i.test(audit.error.message || "")) {
          const previous = await db
            .from("attendance_event_audit")
            .select("id, result, response_status, response_reason, created_at")
            .eq("idempotency_key", idempotencyKey)
            .maybeSingle();
          if (previous.error || !previous.data) {
            return NextResponse.json({ error: "Could not verify duplicate attendance event" }, { status: 503 });
          }
          const priorStatus = Number(previous.data.response_status ?? 200);
          const priorReason = String(previous.data.response_reason ?? "duplicate");
          if (previous.data.result === "processing") {
            const claimAgeMs = Date.now() - Date.parse(String(previous.data.created_at ?? ""));
            if (!Number.isFinite(claimAgeMs) || claimAgeMs < 2 * 60 * 1000) {
              // The first request has not committed its attendance effects yet.
              // Keep the native record queued rather than falsely acknowledging
              // and deleting it.
              return NextResponse.json(
                { error: "Attendance event is still processing", reason: priorReason },
                { status: 409 },
              );
            }
            // A process can be killed after claiming the event. Take over a
            // stale claim with a compare-and-swap so concurrent retries cannot
            // both apply the same attendance transition.
            const reclaimed = await db
              .from("attendance_event_audit")
              .update({
                created_at: new Date().toISOString(),
                response_reason: "recovered_stale_claim",
              })
              .eq("id", previous.data.id)
              .eq("result", "processing")
              .eq("created_at", previous.data.created_at)
              .select("id")
              .maybeSingle();
            if (reclaimed.error || !reclaimed.data) {
              return NextResponse.json(
                { error: "Attendance event is being recovered" },
                { status: 409 },
              );
            }
            recoveredAuditId = String(reclaimed.data.id ?? "");
          }
          if (!recoveredAuditId && priorStatus >= 400) {
            return NextResponse.json({ error: priorReason }, { status: priorStatus });
          }
          if (!recoveredAuditId) {
            return NextResponse.json({ ok: true, ignored: true, reason: priorReason });
          }
        } else {
          return NextResponse.json({ error: audit.error.message }, { status: 400 });
        }
      }
      const auditId = recoveredAuditId ?? String(audit.data?.id ?? "");
      inFlightAudit = auditId ? { db, id: auditId } : null;
    }

    const finishAudit = async (
      result: "accepted" | "ignored" | "rejected",
      responseStatus: number,
      responseReason: string | null,
    ) => {
      if (!inFlightAudit) return;
      const current = inFlightAudit;
      const completed = await current.db
        .from("attendance_event_audit")
        .update({
          result,
          response_status: responseStatus,
          response_reason: responseReason,
        })
        .eq("id", current.id);
      if (completed.error) {
        throw new Error(`Could not finalize attendance ingest audit: ${completed.error.message}`);
      }
      inFlightAudit = null;
    };

    // ── Load what the decision needs ────────────────────────────────────────
    const settingsRow = await db.from("companies").select(SETTINGS_COLUMNS).eq("id", companyId).maybeSingle();
    const settings = mapCompanyJobsiteSettings(settingsRow.data);
    // Null until the company has valid, configured work hours + timezone. When
    // null we never derive a company scheduled window or an arrival status.
    const workSchedule = resolveCompanyWorkSchedule(settingsRow.data as unknown as CompanyConfigRow | null);
    // Early-arrival behavior + the dwell the whole pipeline enforces. Resolved
    // once here and passed down so the foreground pass and the scheduled process
    // agree exactly.
    const attendanceSettings = mapRowToAttendanceSettings(
      settingsRow.data as unknown as Record<string, unknown> | null
    );
    const arrivalConfirmationSeconds = resolveArrivalConfirmationSeconds(
      attendanceSettings,
      settings.arrivalConfirmationSeconds
    );
    const departureGraceMinutes = resolveDepartureGraceMinutes(
      attendanceSettings,
      settings.departureGraceMinutes
    );
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
    if (jobResult.error) {
      await finishAudit("rejected", 400, jobResult.error.message);
      return NextResponse.json({ error: jobResult.error.message }, { status: 400 });
    }
    if (!jobResult.data) {
      await finishAudit("rejected", 404, "Job not found in your company");
      return NextResponse.json({ error: "Job not found in your company" }, { status: 404 });
    }

    // The verified-address requirement only gates AUTOMATIC tracking — manual
    // clock-in/out must keep working as a fallback even at a job whose address
    // hasn't been verified yet.
    const hasVerifiedCoords =
      Boolean(jobResult.data.address_verified) && jobResult.data.lat !== null && jobResult.data.lng !== null;
    if (!hasVerifiedCoords && source === "jobsite_auto") {
      await finishAudit("rejected", 422, "Address needs verification");
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
      await finishAudit("rejected", 403, "No employee record for this user in the company");
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
        await finishAudit("ignored", 200, "not_assigned");
        return NextResponse.json({ ignored: true, reason: "not_assigned" });
      }
      await finishAudit("rejected", 403, "Employee is not assigned to this job");
      return NextResponse.json({ error: "Employee is not assigned to this job" }, { status: 403 });
    }

    // Wake zone only wakes closer monitoring — it never creates/updates a
    // timecard by itself, so skip the (company-wide) pending-attendance sweep
    // for it entirely.
    if (input.zone === "wake") {
      await finishAudit("accepted", 200, "wake");
      return NextResponse.json({ ok: true, zone: "wake" });
    }

    await finalizePendingAttendance({
      db,
      companyId,
      arrivalConfirmationSeconds,
      departureGraceMinutes,
      earlyArrivalMode: attendanceSettings.earlyArrivalMode,
      workSchedule,
      // Finalization is always evaluated against real time, never the event's
      // occurredAt — a delayed/offline event must not stop a due clock-in.
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
      trustedRegionTransition: viaToken,
    });

    // Today's record for this employee+job (one session per work day, though a
    // closed one may be followed by another).
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

    // Records still open at OTHER jobs today. Only an arrival can resolve them,
    // so this is not loaded for exits.
    let otherOpenCards: OtherOpenCard[] = [];
    if (input.transition === "enter") {
      const otherOpen = await db
        .from("jobsite_timecards")
        .select("*")
        .eq("company_id", companyId)
        .eq("user_id", userId)
        .eq("work_date", workDate)
        .not("job_id", "eq", jobId)
        .is("clock_out_at", null)
        .limit(5);
      otherOpenCards = (otherOpen.data ?? []).map(toOtherOpenCard);
    }

    // ── Decide ──────────────────────────────────────────────────────────────
    const decision = decideGeofenceEvent({
      transition: input.transition,
      occurredAt,
      source,
      evaluation,
      card: toGeofenceCard(existing.data),
      otherOpenCards,
      departureGraceMinutes,
      requireApproval: settings.requireApproval,
    });

    // ── Apply ───────────────────────────────────────────────────────────────
    // Always applied, including for ignored/rejected outcomes: those decisions
    // carry no mutations, but some of them still carry an audit row (an exit
    // with nothing open is recorded precisely so it is not silently dropped).
    const applied = await applyGeofenceDecision(
      db,
      {
        companyId,
        userId,
        employeeId,
        jobId,
        workDate,
        scheduledStart,
        scheduledEnd,
        radiusFeet: settings.arrivalRadiusFeet,
        source,
        provenance,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        accuracyMeters: input.accuracyMeters ?? null,
      },
      decision,
      existing.data ?? null
    );
    // ── Respond ─────────────────────────────────────────────────────────────
    if (decision.response.kind === "error") {
      await finishAudit("rejected", decision.response.status, decision.response.message);
      return NextResponse.json(
        { error: decision.response.message },
        { status: decision.response.status }
      );
    }
    if (decision.response.kind === "ignored") {
      await finishAudit("ignored", 200, decision.response.reason);
      return NextResponse.json({ item: null, ignored: true, reason: decision.response.reason });
    }
    await finishAudit("accepted", 200, null);
    return NextResponse.json({ item: applied.timecard ? mapTimecard(applied.timecard) : null });
  } catch (error) {
    // Release only an unfinished ingest claim so the durable native queue can
    // retry. Completed outcomes remain immutable replay instructions.
    if (inFlightAudit) {
      const current = inFlightAudit;
      inFlightAudit = null;
      await current.db
        .from("attendance_event_audit")
        .delete()
        .eq("id", current.id)
        .eq("result", "processing");
    }
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    // A rejected write (RLS denial, constraint, outage) was already logged with
    // its cause. The caller gets the stable message — the database's complaint
    // is not something an employee can act on, and it describes our schema.
    if (error instanceof AttendanceWriteError) {
      return NextResponse.json({ error: ATTENDANCE_UNAVAILABLE_MESSAGE }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "Unexpected server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
