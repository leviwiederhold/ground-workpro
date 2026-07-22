// Manager attendance corrections.
//
// A correction changes the EFFECTIVE record and appends to the permanent
// history — it never rewrites what the system observed. The database triggers
// added alongside this route make that structural: the event trail and the
// correction rows reject UPDATE and DELETE outright, so even this code cannot
// erase them.
//
// Authorization is enforced HERE, on the server, against the effective role —
// never on the client, and deliberately narrower than the set of roles that can
// merely view timecards.

import { NextResponse } from "next/server";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getEffectiveRole } from "@/lib/auth/effectiveRole";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  ATTENDANCE_UNAVAILABLE_MESSAGE,
  AttendanceWriteError,
  assertWrite,
  getAttendanceWriteDb,
} from "@/lib/attendance/attendanceDb";
import { canManageTimecards, computeTotalMinutes, mapTimecard } from "@/lib/jobsite-time/domain";
import {
  canCorrectAttendance,
  isNoOpCorrection,
  planCorrection,
  validateCorrection,
  type CorrectionRecord,
  type TimecardSnapshot,
} from "@/lib/attendance/corrections";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
function toSnapshot(row: any): TimecardSnapshot {
  return {
    id: String(row.id),
    jobId: row.job_id === null || row.job_id === undefined ? null : String(row.job_id),
    workDate: row.work_date ?? null,
    clockInAt: row.clock_in_at ?? null,
    clockOutAt: row.clock_out_at ?? null,
    breakStartAt: row.break_start_at ?? null,
    breakEndAt: row.break_end_at ?? null,
    status: String(row.status ?? "active"),
  };
}

function mapCorrection(row: any): CorrectionRecord {
  return {
    id: String(row.id),
    correctionType: row.correction_type,
    reason: String(row.reason ?? ""),
    originalValues: (row.original_values ?? {}) as Record<string, unknown>,
    newValues: (row.new_values ?? {}) as Record<string, unknown>,
    correctedBy: String(row.corrected_by ?? ""),
    correctedAt: String(row.corrected_at ?? row.created_at ?? ""),
  };
}

/**
 * GET ?timecardId=… — the correction history for one timecard.
 *
 * Readable by managers for any record, and by an employee for their OWN record:
 * someone whose hours were changed is entitled to see who changed them and why.
 */
export async function GET(request: Request) {
  try {
    const { supabase, companyId, userId } = await getCompanyId();
    const role = await getEffectiveRole();
    const db = getSupabaseAdmin() ?? supabase;

    const timecardId = new URL(request.url).searchParams.get("timecardId");
    if (!timecardId) {
      return NextResponse.json({ error: "timecardId is required" }, { status: 422 });
    }

    const card = await db
      .from("jobsite_timecards")
      .select("id, user_id")
      .eq("company_id", companyId)
      .eq("id", timecardId)
      .maybeSingle();
    if (!card.data) return NextResponse.json({ error: "Timecard not found" }, { status: 404 });
    if (!canManageTimecards(role) && String(card.data.user_id ?? "") !== String(userId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const result = await db
      .from("attendance_corrections")
      .select("*")
      .eq("company_id", companyId)
      .eq("timecard_id", timecardId)
      .order("corrected_at", { ascending: true });
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });

    return NextResponse.json({ items: (result.data ?? []).map(mapCorrection) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}

/** POST — record and apply a correction. Manager-only. */
export async function POST(request: Request) {
  try {
    const { companyId, userId } = await getCompanyId();
    const role = await getEffectiveRole();
    // Correcting payroll is a narrower privilege than reading a roster.
    if (!canCorrectAttendance(role)) {
      return NextResponse.json({ error: "Not permitted to correct attendance" }, { status: 403 });
    }
    // A correction writes three tables. There is no session-client fallback:
    // attendance tables are SELECT-only for authenticated users.
    const db = getAttendanceWriteDb("POST /api/attendance/corrections");
    if (!db) {
      return NextResponse.json({ error: ATTENDANCE_UNAVAILABLE_MESSAGE }, { status: 503 });
    }

    const body = await request.json().catch(() => null);
    const parsed = validateCorrection(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: "Validation error", details: parsed.errors }, { status: 422 });
    }

    const timecardId = String((body as Record<string, unknown>)?.timecardId ?? "");
    if (!timecardId) {
      return NextResponse.json({ error: "timecardId is required" }, { status: 422 });
    }

    const current = await db
      .from("jobsite_timecards")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", timecardId)
      .maybeSingle();
    if (current.error) return NextResponse.json({ error: current.error.message }, { status: 400 });
    if (!current.data) return NextResponse.json({ error: "Timecard not found" }, { status: 404 });
    const snapshot = toSnapshot(current.data);

    // A corrected job must still belong to this company — a correction is not a
    // way to point a timecard at someone else's job.
    if (parsed.request.values.jobId) {
      const job = await db
        .from("jobs")
        .select("id")
        .eq("company_id", companyId)
        .eq("id", parsed.request.values.jobId)
        .maybeSingle();
      if (!job.data) {
        return NextResponse.json({ error: "Job not found in your company" }, { status: 422 });
      }
    }

    const now = new Date().toISOString();
    const plan = planCorrection(parsed.request, snapshot, userId, now);
    if (isNoOpCorrection(plan)) {
      // Recording this would put a row in the permanent history claiming a
      // change that never happened.
      return NextResponse.json({ error: "The correction does not change anything" }, { status: 422 });
    }

    // Recompute hours from the corrected values so the effective record and its
    // total can never disagree.
    plan.update.total_minutes = computeTotalMinutes({
      clock_in_at: (plan.update.clock_in_at as string | null) ?? snapshot.clockInAt,
      clock_out_at: (plan.update.clock_out_at as string | null) ?? snapshot.clockOutAt,
      break_start_at: (plan.update.break_start_at as string | null) ?? snapshot.breakStartAt,
      break_end_at: (plan.update.break_end_at as string | null) ?? snapshot.breakEndAt,
    });
    plan.update.correction_count = Number(current.data.correction_count ?? 0) + 1;

    // The correction row is written FIRST. If the timecard update then fails we
    // are left with a recorded intent and an unchanged record — recoverable and
    // visible. The reverse order could silently change payroll with no trail.
    const correction = await db
      .from("attendance_corrections")
      .insert({
        company_id: companyId,
        timecard_id: timecardId,
        employee_id: current.data.employee_id,
        user_id: current.data.user_id,
        correction_type: parsed.request.correctionType,
        reason: parsed.request.reason,
        original_values: plan.originalValues,
        new_values: plan.newValues,
        corrected_by: userId,
        corrected_at: now,
      })
      .select("*")
      .maybeSingle();
    if (correction.error) {
      return NextResponse.json({ error: correction.error.message }, { status: 400 });
    }

    const updated = await db
      .from("jobsite_timecards")
      .update(plan.update)
      .eq("id", timecardId)
      .eq("company_id", companyId)
      .select("*")
      .maybeSingle();
    if (updated.error) return NextResponse.json({ error: updated.error.message }, { status: 400 });

    // Append to the immutable trail, linked to the correction that caused it.
    assertWrite(
      await db.from("jobsite_timecard_events").insert({
      company_id: companyId,
      timecard_id: timecardId,
      event_type: plan.eventType,
      occurred_at: now,
      device_reported_at: null,
      server_received_at: now,
      job_id: current.data.job_id,
      employee_id: current.data.employee_id,
      user_id: current.data.user_id,
      source: "manager_adjusted",
      event_source: "manager_correction",
      validation_result: "accepted",
      validation_reason: parsed.request.correctionType,
        correction_id: correction.data?.id ?? null,
        notes: parsed.request.reason,
      }),
      "audit:correction"
    );

    return NextResponse.json({
      item: mapTimecard(updated.data),
      correction: mapCorrection(correction.data),
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof AttendanceWriteError) {
      return NextResponse.json({ error: ATTENDANCE_UNAVAILABLE_MESSAGE }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "Unexpected server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
