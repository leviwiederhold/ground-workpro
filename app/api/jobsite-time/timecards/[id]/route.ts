/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getEffectiveRole } from "@/lib/auth/effectiveRole";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  ATTENDANCE_UNAVAILABLE_MESSAGE,
  AttendanceWriteError,
  assertWrite,
  getAttendanceWriteDb,
} from "@/lib/attendance/attendanceDb";
import { canManageTimecards, mapTimecard, mapTimecardEvent } from "@/lib/jobsite-time/domain";

export const dynamic = "force-dynamic";

async function loadTimecard(db: any, companyId: string, id: string) {
  return db.from("jobsite_timecards").select("*").eq("company_id", companyId).eq("id", id).maybeSingle();
}

// GET detail (+ event timeline). Managers: any company row. Employees: own only.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, companyId, userId } = await getCompanyId();
    const role = await getEffectiveRole();
    const isManager = canManageTimecards(role);
    const db = getSupabaseAdmin() ?? supabase;

    const result = await loadTimecard(db, companyId, id);
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
    if (!result.data) return NextResponse.json({ error: "Timecard not found" }, { status: 404 });
    if (!isManager && String(result.data.user_id ?? "") !== String(userId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const eventsResult = await db
      .from("jobsite_timecard_events")
      .select("*")
      .eq("company_id", companyId)
      .eq("timecard_id", id)
      .order("occurred_at", { ascending: true });

    return NextResponse.json({
      item: mapTimecard(result.data),
      events: (eventsResult.data ?? []).map(mapTimecardEvent),
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof AttendanceWriteError) {
      return NextResponse.json({ error: ATTENDANCE_UNAVAILABLE_MESSAGE }, { status: 503 });
    }
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}

// Fields that change what the record SAYS about hours worked. They are not
// accepted here at all — see the note on PATCH below.
const CORRECTABLE_FIELDS = ["clockInAt", "clockOutAt", "breakStartAt", "breakEndAt", "jobId"] as const;

const patchSchema = z.object({
  action: z.enum(["approve", "note"]).optional(),
  status: z.enum(["active", "pending_review", "approved", "needs_review"]).optional(),
  notes: z.string().max(2000).optional(),
});

// PATCH: approve / note / workflow status only. Manager-only (server enforced),
// even if the UI fails.
//
// This route deliberately CANNOT change recorded hours or void a record. Both
// are corrections, and a correction has to carry a reason, an original-values
// snapshot, and an immutable row in attendance_corrections — guarantees that
// only POST /api/attendance/corrections provides, and that this endpoint used to
// let a manager walk straight past by PATCHing clock_in_at directly.
//
// The two privileges are also not the same: approving is open to
// canManageTimecards() (foreman, executive, operations included), while
// rewriting payroll is admin/pm only. Keeping the correcting powers out of here
// is what keeps that distinction real.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { companyId, userId } = await getCompanyId();
    const role = await getEffectiveRole();
    if (!canManageTimecards(role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const db = getAttendanceWriteDb("PATCH /api/jobsite-time/timecards/[id]");
    if (!db) {
      return NextResponse.json({ error: ATTENDANCE_UNAVAILABLE_MESSAGE }, { status: 503 });
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

    // Refuse rather than silently ignore: a caller that thinks it just changed
    // someone's hours and got a 200 back is the worst possible outcome.
    const attempted = CORRECTABLE_FIELDS.filter((f) => body?.[f] !== undefined);
    if (attempted.length > 0) {
      return NextResponse.json(
        {
          error: "Recorded hours can only be changed through a correction",
          code: "use_corrections_endpoint",
          fields: attempted,
          endpoint: "/api/attendance/corrections",
        },
        { status: 422 }
      );
    }
    if (body?.action === "reject" || body?.status === "rejected") {
      // Voiding a record is a correction too — it changes what the employee is
      // paid, so it needs a reason on the permanent trail.
      return NextResponse.json(
        {
          error: "Voiding a record requires a correction with a reason",
          code: "use_corrections_endpoint",
          correctionTypes: ["duplicate_record", "invalid_record"],
          endpoint: "/api/attendance/corrections",
        },
        { status: 422 }
      );
    }

    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation error", details: parsed.error.flatten() }, { status: 422 });
    }
    const d = parsed.data;

    const current = await loadTimecard(db, companyId, id);
    if (current.error) return NextResponse.json({ error: current.error.message }, { status: 400 });
    if (!current.data) return NextResponse.json({ error: "Timecard not found" }, { status: 404 });
    const row = current.data;

    const update: Record<string, unknown> = {};
    let eventType: string | null = null;

    if (d.notes !== undefined) {
      update.notes = d.notes;
      eventType = "manager_edited";
    }
    if (d.action === "approve" || d.status === "approved") {
      update.status = "approved";
      update.approved_by = userId;
      update.approved_at = new Date().toISOString();
      eventType = "approved";
    } else if (d.status) {
      update.status = d.status;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "No changes provided" }, { status: 422 });
    }

    const result = await db
      .from("jobsite_timecards")
      .update(update)
      .eq("id", id)
      .eq("company_id", companyId)
      .select("*")
      .maybeSingle();
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });

    if (eventType) {
      assertWrite(
        await db.from("jobsite_timecard_events").insert({
        company_id: companyId,
        timecard_id: id,
        event_type: eventType,
        occurred_at: new Date().toISOString(),
        // A manager edit has no device behind it, so device_reported_at is
        // deliberately null rather than echoing the server time.
        event_source: "manager_correction",
        device_reported_at: null,
        server_received_at: new Date().toISOString(),
        validation_result: "accepted",
        validation_reason: d.action ?? "edit",
        job_id: row.job_id,
        employee_id: row.employee_id,
        user_id: row.user_id,
        source: "manager_adjusted",
        notes: d.notes ?? null,
        }),
        `audit:${eventType}`
      );
    }

    return NextResponse.json({ item: mapTimecard(result.data) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof AttendanceWriteError) {
      return NextResponse.json({ error: ATTENDANCE_UNAVAILABLE_MESSAGE }, { status: 503 });
    }
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}
