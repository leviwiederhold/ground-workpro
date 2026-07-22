/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getEffectiveRole } from "@/lib/auth/effectiveRole";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { canManageTimecards, computeTotalMinutes, mapTimecard, mapTimecardEvent } from "@/lib/jobsite-time/domain";

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
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}

const isoOrNull = z.string().datetime().nullable().optional();
const patchSchema = z.object({
  action: z.enum(["approve", "reject", "edit", "note"]).optional(),
  clockInAt: isoOrNull,
  clockOutAt: isoOrNull,
  breakStartAt: isoOrNull,
  breakEndAt: isoOrNull,
  status: z.enum(["active", "pending_review", "approved", "rejected", "needs_review"]).optional(),
  notes: z.string().max(2000).optional(),
});

// PATCH: manager edit / approve / reject / note. Manager-only (server enforced),
// even if the UI fails. Payroll is never finalized without approval here.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, companyId, userId } = await getCompanyId();
    const role = await getEffectiveRole();
    if (!canManageTimecards(role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const db = getSupabaseAdmin() ?? supabase;

    const parsed = patchSchema.safeParse(await request.json().catch(() => null));
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

    const editedTimes =
      d.clockInAt !== undefined || d.clockOutAt !== undefined || d.breakStartAt !== undefined || d.breakEndAt !== undefined;
    if (editedTimes) {
      if (d.clockInAt !== undefined) update.clock_in_at = d.clockInAt;
      if (d.clockOutAt !== undefined) update.clock_out_at = d.clockOutAt;
      if (d.breakStartAt !== undefined) update.break_start_at = d.breakStartAt;
      if (d.breakEndAt !== undefined) update.break_end_at = d.breakEndAt;
      update.source = "manager_adjusted";
      update.total_minutes = computeTotalMinutes({
        clock_in_at: (update.clock_in_at as string) ?? row.clock_in_at,
        clock_out_at: (update.clock_out_at as string) ?? row.clock_out_at,
        break_start_at: (update.break_start_at as string) ?? row.break_start_at,
        break_end_at: (update.break_end_at as string) ?? row.break_end_at,
      });
      eventType = "manager_edited";
    }
    if (d.notes !== undefined) {
      update.notes = d.notes;
      if (!eventType) eventType = "manager_edited";
    }
    if (d.action === "approve" || d.status === "approved") {
      update.status = "approved";
      update.approved_by = userId;
      update.approved_at = new Date().toISOString();
      eventType = "approved";
    } else if (d.action === "reject" || d.status === "rejected") {
      update.status = "rejected";
      eventType = "rejected";
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
      });
    }

    return NextResponse.json({ item: mapTimecard(result.data) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}
