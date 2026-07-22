/* eslint-disable @typescript-eslint/no-explicit-any */
// Applies a decideGeofenceEvent() decision.
//
// The counterpart to applyClockInDecision()/applyClockOutDecision(): the engine
// decides, this performs the writes and the audit rows, and the HTTP route does
// neither. Every write to jobsite_timecards that originates from a geofence
// transition goes through here.
//
// Ordering is load-bearing and mirrors the decision: transfers first (so an
// employee is never open at two jobs simultaneously), then this job's record,
// then the audit rows — which is what leaves a recorded intent rather than a
// silent change if a write fails midway.

import type { EventDraft, GeofenceDecision, PrimaryEffect } from "./geofenceEvent.ts";
import { assertWrite } from "./attendanceDb.ts";

export type GeofenceApplyContext = {
  companyId: string;
  userId: string;
  employeeId: string;
  jobId: string | number;
  workDate: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  radiusFeet: number | null;
  source: "jobsite_auto" | "manual";
  // Audit provenance, identical on every row this request writes.
  provenance: {
    event_source: string;
    device_reported_at: string | null;
    server_received_at: string;
  };
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
};

const round4 = (v: number | null | undefined) =>
  v === null || v === undefined ? null : Math.round(v * 10000) / 10000;

async function insertEvent(
  db: any,
  ctx: GeofenceApplyContext,
  draft: EventDraft,
  timecardId: string | null,
  jobId: string | number | null
) {
  const row: Record<string, unknown> = {
    company_id: ctx.companyId,
    timecard_id: timecardId,
    event_type: draft.eventType,
    occurred_at: draft.occurredAt,
    ...ctx.provenance,
    validation_result: draft.validationResult,
    validation_reason: draft.validationReason,
    job_id: jobId,
    employee_id: ctx.employeeId,
    user_id: ctx.userId,
    source: ctx.source,
  };
  if (draft.withLocation) {
    row.latitude = round4(ctx.latitude);
    row.longitude = round4(ctx.longitude);
    row.accuracy_meters = ctx.accuracyMeters ?? null;
  }
  if (draft.notes !== undefined) row.notes = draft.notes;
  // A dropped audit row is not cosmetic: the trail is the record of what the
  // device reported, and a silent gap in it is unrecoverable.
  assertWrite(await db.from("jobsite_timecard_events").insert(row), `audit:${draft.eventType}`);
}

/**
 * Perform the primary effect.
 *
 * Returns the resulting row and whether the write actually matched. The two are
 * not the same thing: the guarded updates carry `.is("clock_out_at", null)`, so
 * a concurrent finalization can legitimately match nothing — in which case the
 * events gated on `requiresPrimaryApplied` are skipped rather than describing a
 * change that did not happen. That is a no-op, not a failure.
 *
 * A rejected write (including an RLS denial) throws instead: it must never be
 * mistaken for the race above and reported as success.
 */
async function applyPrimary(
  db: any,
  ctx: GeofenceApplyContext,
  effect: PrimaryEffect,
  current: any | null
): Promise<{ timecard: any | null; applied: boolean }> {
  switch (effect.kind) {
    case "none":
      return { timecard: current, applied: false };

    case "open_session": {
      const insert = await db
        .from("jobsite_timecards")
        .insert({
          company_id: ctx.companyId,
          employee_id: ctx.employeeId,
          user_id: ctx.userId,
          job_id: ctx.jobId,
          work_date: ctx.workDate,
          scheduled_start: ctx.scheduledStart,
          scheduled_end: ctx.scheduledEnd,
          geofence_radius_feet: ctx.radiusFeet,
          pending_arrival_at: effect.pendingArrivalAt,
          arrival_status: effect.arrivalStatus,
          status: effect.status,
          source: ctx.source,
          confidence: effect.confidence,
        })
        .select("*")
        .maybeSingle();
      assertWrite(insert, "open_session");
      return { timecard: insert.data, applied: Boolean(insert.data) };
    }

    case "record_arrival": {
      const upd = await db
        .from("jobsite_timecards")
        .update({
          pending_arrival_at: effect.pendingArrivalAt,
          arrival_status: effect.arrivalStatus,
          confidence: effect.confidence,
        })
        .eq("id", effect.timecardId)
        .eq("company_id", ctx.companyId)
        .select("*")
        .maybeSingle();
      assertWrite(upd, "record_arrival");
      return { timecard: upd.data, applied: Boolean(upd.data) };
    }

    case "cancel_departure": {
      const upd = await db
        .from("jobsite_timecards")
        .update({ pending_departure_at: null, detected_departure_at: null })
        .eq("id", effect.timecardId)
        .eq("company_id", ctx.companyId)
        .is("clock_out_at", null)
        .select("*")
        .maybeSingle();
      assertWrite(upd, "cancel_departure");
      return { timecard: upd.data ?? current, applied: Boolean(upd.data) };
    }

    case "cancel_pending_arrival": {
      const upd = await db
        .from("jobsite_timecards")
        .update({ pending_arrival_at: null })
        .eq("id", effect.timecardId)
        .eq("company_id", ctx.companyId)
        .select("*")
        .maybeSingle();
      assertWrite(upd, "cancel_pending_arrival");
      return { timecard: upd.data, applied: Boolean(upd.data) };
    }

    case "begin_departure": {
      const upd = await db
        .from("jobsite_timecards")
        .update({
          pending_departure_at: effect.departureAt,
          detected_departure_at: effect.detectedDepartureAt,
          confidence: effect.confidence,
          status: effect.status,
        })
        .eq("id", effect.timecardId)
        .eq("company_id", ctx.companyId)
        .is("clock_out_at", null)
        .select("*")
        .maybeSingle();
      assertWrite(upd, "begin_departure");
      return { timecard: upd.data ?? current, applied: Boolean(upd.data) };
    }
  }
}

/**
 * Apply one geofence decision: transfers, then the primary effect, then audit.
 *
 * `current` is the record the decision was made against, returned unchanged
 * when the decision was to do nothing.
 */
export async function applyGeofenceDecision(
  db: any,
  ctx: GeofenceApplyContext,
  decision: GeofenceDecision,
  current: any | null
): Promise<{ timecard: any | null }> {
  // Transfers first — resolving job A before opening job B is what prevents an
  // employee from being open at two jobsites at once.
  for (const transfer of decision.transfers) {
    if (transfer.kind === "cancel_pending_arrival") {
      assertWrite(
        await db
          .from("jobsite_timecards")
          .update({ pending_arrival_at: null })
          .eq("id", transfer.timecardId)
          .eq("company_id", ctx.companyId),
        "transfer:cancel_pending_arrival"
      );
    } else {
      // If this fails the employee would be left open at two jobs, so it must
      // stop the request rather than let job B open on top of job A.
      assertWrite(
        await db
          .from("jobsite_timecards")
          .update({
            pending_departure_at: transfer.departureAt,
            detected_departure_at: transfer.departureAt,
          })
          .eq("id", transfer.timecardId)
          .eq("company_id", ctx.companyId),
        "transfer:begin_departure"
      );
    }
    if (transfer.event) {
      await insertEvent(db, ctx, transfer.event, transfer.timecardId, transfer.jobId);
    }
  }

  const primary = await applyPrimary(db, ctx, decision.primary, current);

  for (const draft of decision.events) {
    if (draft.requiresPrimaryApplied && !primary.applied) continue;
    if (draft.target.kind === "card") {
      // A card-targeted draft with an empty id is the "no record at all" case
      // (an exit with nothing open), which is audited without a timecard.
      const id = draft.target.timecardId || null;
      await insertEvent(db, ctx, draft, id, draft.target.jobId ?? ctx.jobId);
    } else {
      await insertEvent(db, ctx, draft, primary.timecard?.id ?? null, ctx.jobId);
    }
  }

  return { timecard: primary.timecard };
}
