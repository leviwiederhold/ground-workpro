/* eslint-disable @typescript-eslint/no-explicit-any */
// Server-side finalization of pending arrivals/departures. Native (and the
// foreground fallback) report raw enter/exit transitions the instant they are
// observed; the arrival-confirmation delay and departure-grace-period are
// enforced HERE, lazily, the same way src/lib/time-clock/autoClose.ts closes
// stale time entries — called from the read/write API routes rather than a
// background cron, since there is no cron worker in this deployment.

import { computeTotalMinutes } from "./domain";

type TimecardRow = {
  id: string;
  company_id: string;
  job_id: string | null;
  employee_id: string | null;
  user_id: string | null;
  clock_in_at: string | null;
  clock_out_at: string | null;
  break_start_at: string | null;
  break_end_at: string | null;
  pending_arrival_at: string | null;
  pending_departure_at: string | null;
};

export async function finalizePendingAttendance({
  db,
  companyId,
  arrivalConfirmationSeconds,
  departureGraceMinutes,
}: {
  db: any;
  companyId: string;
  arrivalConfirmationSeconds: number;
  departureGraceMinutes: number;
}): Promise<void> {
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const result = await db
    .from("jobsite_timecards")
    .select(
      "id, company_id, job_id, employee_id, user_id, clock_in_at, clock_out_at, break_start_at, break_end_at, pending_arrival_at, pending_departure_at"
    )
    .eq("company_id", companyId)
    .is("clock_out_at", null)
    .gte("work_date", twoDaysAgo)
    .limit(300);
  if (result.error || !result.data?.length) return;

  const now = Date.now();
  for (const row of result.data as TimecardRow[]) {
    if (row.pending_arrival_at && !row.clock_in_at) {
      const readyAt = Date.parse(row.pending_arrival_at) + arrivalConfirmationSeconds * 1000;
      if (Number.isFinite(readyAt) && now >= readyAt) {
        const upd = await db
          .from("jobsite_timecards")
          .update({
            clock_in_at: row.pending_arrival_at,
            detected_arrival_at: row.pending_arrival_at,
            pending_arrival_at: null,
          })
          .eq("id", row.id)
          .eq("company_id", companyId)
          .is("clock_in_at", null)
          .select("id")
          .maybeSingle();
        // Only log the audit event if THIS call actually applied the
        // transition — a concurrent request may have already finalized it
        // (the `.is("clock_in_at", null)` guard above would then match zero
        // rows), which would otherwise double-insert the audit event.
        if (upd.data) {
          await db.from("jobsite_timecard_events").insert({
            company_id: companyId,
            timecard_id: row.id,
            event_type: "auto_clock_in",
            occurred_at: row.pending_arrival_at,
            job_id: row.job_id,
            employee_id: row.employee_id,
            user_id: row.user_id,
            source: "jobsite_auto",
          });
        }
      }
      // An employee can't simultaneously be "not yet arrived" and "pending
      // departure" — nothing more to do for this row this pass.
      continue;
    }

    if (row.pending_departure_at && row.clock_in_at && !row.clock_out_at) {
      const readyAt = Date.parse(row.pending_departure_at) + departureGraceMinutes * 60000;
      if (Number.isFinite(readyAt) && now >= readyAt) {
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
