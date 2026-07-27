/* eslint-disable @typescript-eslint/no-explicit-any */
// Server-side finalization of pending arrivals/departures, run opportunistically
// from the read/write API routes.
//
// Both halves delegate to the same engines the scheduled process uses —
// decideArrivalClockIn() and decideClockOut() — so an arrival before the
// scheduled start is held as "onsite before shift" rather than clocked in
// early, a brief exit never ends a shift, and a foreground request can never
// race the scheduler into a duplicate record.
//
// This pass is a FALLBACK, not the mechanism: with the app closed nothing calls
// it, which is exactly why /api/attendance/reconcile exists.

import { scheduledWindowForWorkDate, type CompanyWorkScheduleSettings } from "./domain.ts";
import { decideArrivalClockIn, type EarlyArrivalMode } from "../attendance/scheduledClockIn.ts";
import { applyClockInDecision, buildOpenElsewhere } from "../attendance/scheduledClockInRunner.ts";
import { decideClockOut } from "../attendance/departure.ts";
import { applyClockOutDecision } from "../attendance/departureRunner.ts";
import { assertWrite } from "../attendance/attendanceDb.ts";

type TimecardRow = {
  id: string;
  company_id: string;
  job_id: string | null;
  employee_id: string | null;
  user_id: string | null;
  work_date: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  clock_in_at: string | null;
  clock_out_at: string | null;
  break_start_at: string | null;
  break_end_at: string | null;
  pending_arrival_at: string | null;
  pending_departure_at: string | null;
  onsite_before_shift_at: string | null;
  detected_arrival_at: string | null;
  detected_departure_at: string | null;
  status: string | null;
  monitoring_stopped_at: string | null;
};

const SELECT_COLUMNS =
  "id, company_id, job_id, employee_id, user_id, work_date, scheduled_start, scheduled_end, clock_in_at," +
  " clock_out_at, break_start_at, break_end_at, pending_arrival_at, pending_departure_at," +
  " onsite_before_shift_at, detected_arrival_at, detected_departure_at, status, monitoring_stopped_at";

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
  // A failed load is not "nothing to finalize". Returning quietly here is how a
  // denied read used to look identical to an empty result, leaving arrivals and
  // departures permanently unmatured with no error anywhere.
  assertWrite(result, "finalize:load_open_cards");
  if (!result.data?.length) return;

  const rows = result.data as TimecardRow[];
  // Which employees already have an open clock-in at some other job — a second
  // concurrent clock-in must be refused rather than created.
  const openElsewhere = buildOpenElsewhere(rows);

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

    if (row.clock_in_at && !row.clock_out_at) {
      // Departures go through the same engine as the scheduled pass. The
      // end-of-day fallback is deliberately NOT run here: closing a shift that
      // produced no exit event is a scheduled-process responsibility, not
      // something an incidental foreground request should trigger.
      const decision = decideClockOut({
        now,
        card: {
          clockInAt: row.clock_in_at,
          clockOutAt: row.clock_out_at,
          pendingDepartureAt: row.pending_departure_at,
        },
        departureGraceMinutes,
        endOfDayCutoffMinutes: 0,
      });
      await applyClockOutDecision(db, row, decision, now);
    }
  }
}
