/* eslint-disable @typescript-eslint/no-explicit-any */
// Server-side finalization of pending arrivals/departures, run opportunistically
// from the read/write API routes.
//
// The arrival half now delegates to decideArrivalClockIn() — the same engine the
// scheduled process uses — so an arrival before the scheduled start is held as
// "onsite before shift" instead of being clocked in early, and so a foreground
// request can never race the scheduler into two clock-ins.
//
// This pass is a FALLBACK, not the mechanism: with the app closed nothing calls
// it, which is exactly why /api/attendance/scheduled-clock-in exists. Departures
// are still finalized here (PR 12 moves them to the scheduled process too).

import { computeTotalMinutes, scheduledWindowForWorkDate, type CompanyWorkScheduleSettings } from "./domain";
import { decideArrivalClockIn, type EarlyArrivalMode } from "../attendance/scheduledClockIn";
import { applyClockInDecision, buildOpenElsewhere } from "../attendance/scheduledClockInRunner";

type TimecardRow = {
  id: string;
  company_id: string;
  job_id: string | null;
  employee_id: string | null;
  user_id: string | null;
  work_date: string | null;
  scheduled_start: string | null;
  clock_in_at: string | null;
  clock_out_at: string | null;
  break_start_at: string | null;
  break_end_at: string | null;
  pending_arrival_at: string | null;
  pending_departure_at: string | null;
  onsite_before_shift_at: string | null;
  detected_arrival_at: string | null;
};

const SELECT_COLUMNS =
  "id, company_id, job_id, employee_id, user_id, work_date, scheduled_start, clock_in_at, clock_out_at," +
  " break_start_at, break_end_at, pending_arrival_at, pending_departure_at, onsite_before_shift_at, detected_arrival_at";

export async function finalizePendingAttendance({
  db,
  companyId,
  arrivalConfirmationSeconds,
  departureGraceMinutes,
  earlyArrivalMode = "scheduled_start",
  workSchedule = null,
  now = new Date().toISOString(),
}: {
  db: any;
  companyId: string;
  arrivalConfirmationSeconds: number;
  departureGraceMinutes: number;
  // Company early-arrival behavior. Defaults to holding until scheduled start,
  // matching the product default.
  earlyArrivalMode?: EarlyArrivalMode;
  // Used only to derive a scheduled start for rows that were created without
  // one; null when the company has no valid configured work hours.
  workSchedule?: CompanyWorkScheduleSettings | null;
  now?: string;
}): Promise<void> {
  const twoDaysAgo = new Date(Date.parse(now) - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const result = await db
    .from("jobsite_timecards")
    .select(SELECT_COLUMNS)
    .eq("company_id", companyId)
    .is("clock_out_at", null)
    .gte("work_date", twoDaysAgo)
    .limit(300);
  if (result.error || !result.data?.length) return;

  const rows = result.data as TimecardRow[];
  // Which employees already have an open clock-in at some other job — a second
  // concurrent clock-in must be refused rather than created.
  const openElsewhere = buildOpenElsewhere(rows);
  const nowMs = Date.parse(now);

  for (const row of rows) {
    if (row.pending_arrival_at && !row.clock_in_at) {
      const scheduledStart =
        row.scheduled_start ??
        (workSchedule && row.work_date
          ? scheduledWindowForWorkDate(row.work_date, workSchedule).scheduledStart
          : null);
      const otherJobId = row.user_id ? openElsewhere.get(row.user_id) : undefined;
      const decision = decideArrivalClockIn({
        now,
        card: {
          pendingArrivalAt: row.pending_arrival_at,
          clockInAt: row.clock_in_at,
          clockOutAt: row.clock_out_at,
          onsiteBeforeShiftAt: row.onsite_before_shift_at,
        },
        scheduledStart,
        earlyArrivalMode,
        arrivalConfirmationSeconds,
        openElsewhereJobId:
          otherJobId && otherJobId !== String(row.job_id ?? "") ? otherJobId : null,
      });
      await applyClockInDecision(db, row, decision, now);
      // An employee can't simultaneously be "not yet arrived" and "pending
      // departure" — nothing more to do for this row this pass.
      continue;
    }

    if (row.pending_departure_at && row.clock_in_at && !row.clock_out_at) {
      const readyAt = Date.parse(row.pending_departure_at) + departureGraceMinutes * 60000;
      if (Number.isFinite(readyAt) && nowMs >= readyAt) {
        const totalMinutes = computeTotalMinutes({ ...row, clock_out_at: row.pending_departure_at });
        const upd = await db
          .from("jobsite_timecards")
          .update({
            clock_out_at: row.pending_departure_at,
            detected_departure_at: row.pending_departure_at,
            pending_departure_at: null,
            total_minutes: totalMinutes,
          })
          .eq("id", row.id)
          .eq("company_id", companyId)
          .is("clock_out_at", null)
          .select("id")
          .maybeSingle();
        // Only log the audit event if THIS call actually applied the
        // transition — a concurrent request may have already finalized it
        // (the `.is("clock_out_at", null)` guard above would then match zero
        // rows), which would otherwise double-insert the audit event.
        if (upd.data) {
          await db.from("jobsite_timecard_events").insert({
            company_id: companyId,
            timecard_id: row.id,
            event_type: "auto_clock_out",
            occurred_at: row.pending_departure_at,
            job_id: row.job_id,
            employee_id: row.employee_id,
            user_id: row.user_id,
            source: "jobsite_auto",
          });
        }
      }
    }
  }
}
