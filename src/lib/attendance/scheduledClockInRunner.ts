/* eslint-disable @typescript-eslint/no-explicit-any */
// Server-side scheduled reconciliation for automatic arrival → clock-in.
//
// This is the process that makes "clocked in at 7:00 without opening the app"
// true. It runs on the SERVER on a schedule (Vercel Cron → the
// /api/attendance/scheduled-clock-in route); it deliberately does not depend on
// a WebView timer, a foreground app, or the phone staying awake. The native
// geofence supplies the arrival; this supplies the clock.
//
// Every decision comes from decideArrivalClockIn() so the scheduler, the
// foreground reconciliation, and the native event path cannot disagree. Writes
// are guarded by `.is("clock_in_at", null)` so a race between them produces one
// record and one audit event, never two.

import {
  mapRowToAttendanceSettings,
  resolveArrivalConfirmationSeconds,
  type AutomaticAttendanceSettings,
} from "./attendanceSettings.ts";
import { decideArrivalClockIn, type ArrivalCard, type ClockInAction } from "./scheduledClockIn.ts";
import { resolveCompanyWorkSchedule, type CompanyConfigRow } from "../company/companyConfig.ts";
import { scheduledWindowForWorkDate } from "../jobsite-time/domain.ts";

// Company columns needed to decide a clock-in: automatic-attendance settings +
// work schedule (for a work date whose timecard has no stored scheduled_start).
const COMPANY_COLUMNS =
  "id,timezone,default_work_days,default_work_start_time,default_work_end_time," +
  "attendance_automatic_enabled,attendance_arrival_dwell_minutes,attendance_early_arrival_mode," +
  "attendance_early_arrival_window_minutes,attendance_late_grace_minutes," +
  "jobsite_arrival_confirmation_seconds";

const CANDIDATE_COLUMNS =
  "id,company_id,job_id,employee_id,user_id,work_date,scheduled_start," +
  "clock_in_at,clock_out_at,pending_arrival_at,pending_departure_at,onsite_before_shift_at,detected_arrival_at";

// How far back the scheduler looks. Two days covers overnight shifts and a
// scheduler outage without ever resurrecting stale weeks-old arrivals.
const LOOKBACK_DAYS = 2;

export type SchedulerSummary = {
  candidates: number;
  clockedIn: number;
  backfilled: number;
  rejected: number;
  suppressed: number;
  waiting: number;
  onsiteBeforeShift: number;
  companies: number;
};

type CandidateRow = {
  id: string;
  company_id: string;
  job_id: string | null;
  employee_id: string | null;
  user_id: string | null;
  work_date: string | null;
  scheduled_start: string | null;
  clock_in_at: string | null;
  clock_out_at: string | null;
  pending_arrival_at: string | null;
  pending_departure_at: string | null;
  onsite_before_shift_at: string | null;
  detected_arrival_at: string | null;
};

function emptySummary(): SchedulerSummary {
  return {
    candidates: 0,
    clockedIn: 0,
    backfilled: 0,
    rejected: 0,
    suppressed: 0,
    waiting: 0,
    onsiteBeforeShift: 0,
    companies: 0,
  };
}

function lookbackWorkDate(now: Date): string {
  return new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Resolve the scheduled start for a timecard. The stored value wins (it was
 * computed from the schedule in force when the arrival happened); otherwise it
 * is derived from the company's work hours for that work date, which resolves
 * local wall-clock time to UTC per date and is therefore DST-correct.
 */
export function resolveScheduledStart(
  row: Pick<CandidateRow, "scheduled_start" | "work_date">,
  companyRow: Record<string, unknown> | null
): string | null {
  if (row.scheduled_start) return row.scheduled_start;
  if (!row.work_date) return null;
  const schedule = resolveCompanyWorkSchedule(companyRow as unknown as CompanyConfigRow | null);
  if (!schedule) return null;
  return scheduledWindowForWorkDate(row.work_date, schedule).scheduledStart;
}

async function logEvent(
  db: any,
  row: CandidateRow,
  eventType: string,
  occurredAt: string,
  notes?: string
): Promise<void> {
  await db.from("jobsite_timecard_events").insert({
    company_id: row.company_id,
    timecard_id: row.id,
    event_type: eventType,
    occurred_at: occurredAt,
    job_id: row.job_id,
    employee_id: row.employee_id,
    user_id: row.user_id,
    source: "jobsite_auto",
    notes: notes ?? null,
  });
}

/**
 * Apply one decision. Split out so the events route and the scheduler share the
 * exact same write + audit behavior.
 *
 * Returns what actually happened, which is not always what was decided: a
 * concurrent writer can win the `.is("clock_in_at", null)` race, in which case
 * this reports "suppressed" and writes no duplicate record.
 */
export async function applyClockInDecision(
  db: any,
  row: CandidateRow,
  decision: ClockInAction,
  now: string
): Promise<"clocked_in" | "backfilled" | "rejected" | "suppressed" | "waiting" | "onsite_before_shift"> {
  if (decision.action === "skip") {
    if (decision.reason === "already_clocked_in" || decision.reason === "already_closed") {
      return "suppressed";
    }
    if (decision.reason === "no_arrival_evidence") return "waiting";
    // A genuine refusal — record why, once. Re-logging on every pass is avoided
    // by clearing the arrival that would otherwise keep re-triggering it.
    const notes =
      decision.reason === "clocked_in_elsewhere"
        ? "Employee is already clocked into another job"
        : decision.reason === "left_before_shift"
          ? "Employee left the jobsite before the scheduled start"
          : "Scheduled clock-in is outside the backfill window";
    if (decision.reason === "left_before_shift" || decision.reason === "outside_backfill_window") {
      const cleared = await db
        .from("jobsite_timecards")
        .update({ pending_arrival_at: null })
        .eq("id", row.id)
        .eq("company_id", row.company_id)
        .is("clock_in_at", null)
        .not("pending_arrival_at", "is", null)
        .select("id")
        .maybeSingle();
      if (cleared.data) await logEvent(db, row, "clock_in_rejected", now, notes);
      return "rejected";
    }
    // "clocked_in_elsewhere" keeps the pending arrival: the conflict may clear
    // when the other job's departure finalizes, and this arrival is still valid.
    return "rejected";
  }

  if (decision.action === "hold") {
    if (!decision.recordOnsiteBeforeShift) return "waiting";
    const stamped = await db
      .from("jobsite_timecards")
      .update({
        onsite_before_shift_at: decision.onsiteSince,
        detected_arrival_at: row.detected_arrival_at ?? decision.onsiteSince,
      })
      .eq("id", row.id)
      .eq("company_id", row.company_id)
      .is("onsite_before_shift_at", null)
      .select("id")
      .maybeSingle();
    if (stamped.data) {
      await logEvent(
        db,
        row,
        "onsite_before_shift",
        decision.onsiteSince ?? now,
        "Employee arrived and is onsite before the scheduled start"
      );
      return "onsite_before_shift";
    }
    return "waiting";
  }

  // clock_in — the guard is what makes this idempotent across native events,
  // foreground reconciliation, the scheduler, and offline retries.
  const applied = await db
    .from("jobsite_timecards")
    .update({
      clock_in_at: decision.effectiveAt,
      detected_arrival_at: row.detected_arrival_at ?? row.pending_arrival_at,
      pending_arrival_at: null,
      clock_in_method: decision.method,
    })
    .eq("id", row.id)
    .eq("company_id", row.company_id)
    .is("clock_in_at", null)
    .select("id")
    .maybeSingle();

  if (!applied.data) {
    // Someone else clocked this timecard in between our read and our write.
    await logEvent(db, row, "duplicate_suppressed", now, "Clock-in already applied by another writer");
    return "suppressed";
  }

  const scheduled = decision.method !== "arrival";
  await logEvent(
    db,
    row,
    scheduled ? "scheduled_clock_in" : "auto_clock_in",
    decision.effectiveAt,
    scheduled ? "Clock-in created at the scheduled start" : undefined
  );
  if (decision.backfilled) {
    await logEvent(
      db,
      row,
      "clock_in_backfilled",
      decision.effectiveAt,
      `Scheduled processing ran late; clock-in backfilled (processed at ${now})`
    );
    return "backfilled";
  }
  return "clocked_in";
}

/**
 * Build the "is this employee already clocked into a different job" lookup.
 *
 * A card that is already pending departure does NOT block: the employee moved
 * from job A to job B, job A is resolving, and job B's clock-in is correct.
 */
export function buildOpenElsewhere(
  openRows: Array<Pick<CandidateRow, "user_id" | "job_id" | "clock_in_at" | "pending_departure_at">>
): Map<string, string> {
  const byUser = new Map<string, string>();
  for (const row of openRows) {
    if (!row.user_id || !row.clock_in_at || row.pending_departure_at) continue;
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, String(row.job_id ?? ""));
  }
  return byUser;
}

export async function runScheduledAttendanceClockIn({
  db,
  now = new Date().toISOString(),
  companyId,
  limit = 500,
}: {
  db: any;
  now?: string;
  companyId?: string | null;
  limit?: number;
}): Promise<SchedulerSummary> {
  const summary = emptySummary();
  const since = lookbackWorkDate(new Date(now));

  let query = db
    .from("jobsite_timecards")
    .select(CANDIDATE_COLUMNS)
    .is("clock_in_at", null)
    .is("clock_out_at", null)
    .not("pending_arrival_at", "is", null)
    .gte("work_date", since)
    .order("pending_arrival_at", { ascending: true })
    .limit(limit);
  if (companyId) query = query.eq("company_id", companyId);

  const candidates = await query;
  if (candidates.error) throw new Error(candidates.error.message);
  const rows = (candidates.data ?? []) as CandidateRow[];
  summary.candidates = rows.length;
  if (rows.length === 0) return summary;

  const companyIds = Array.from(new Set(rows.map((r) => r.company_id)));
  summary.companies = companyIds.length;

  const companiesResult = await db.from("companies").select(COMPANY_COLUMNS).in("id", companyIds);
  const companyById = new Map<string, Record<string, unknown>>();
  for (const row of (companiesResult.data ?? []) as Array<Record<string, unknown>>) {
    companyById.set(String(row.id), row);
  }

  // Open clock-ins for the same employees, used to refuse a second concurrent
  // clock-in at a different job.
  const openResult = await db
    .from("jobsite_timecards")
    .select("user_id,job_id,clock_in_at,clock_out_at,pending_departure_at")
    .in("company_id", companyIds)
    .is("clock_out_at", null)
    .not("clock_in_at", "is", null)
    .gte("work_date", since)
    .limit(2000);
  const openElsewhere = buildOpenElsewhere((openResult.data ?? []) as any[]);

  // Late-arriving exit events that the candidate row has not absorbed yet (an
  // offline exit flushed after the arrival). Bounded by the candidate set.
  const exitsResult = await db
    .from("jobsite_timecard_events")
    .select("timecard_id,occurred_at")
    .in(
      "timecard_id",
      rows.map((r) => r.id)
    )
    .eq("event_type", "exited_geofence")
    .order("occurred_at", { ascending: false })
    .limit(1000);
  const lastExitByCard = new Map<string, string>();
  for (const event of (exitsResult.data ?? []) as Array<{ timecard_id: string; occurred_at: string }>) {
    if (!lastExitByCard.has(event.timecard_id)) lastExitByCard.set(event.timecard_id, event.occurred_at);
  }

  for (const row of rows) {
    const companyRow = companyById.get(row.company_id) ?? null;
    const settings: AutomaticAttendanceSettings = mapRowToAttendanceSettings(companyRow);
    // The master switch only stops the AUTOMATIC pipeline; existing manual
    // records are untouched.
    if (!settings.automaticAttendanceEnabled) continue;

    const card: ArrivalCard = {
      pendingArrivalAt: row.pending_arrival_at,
      clockInAt: row.clock_in_at,
      clockOutAt: row.clock_out_at,
      onsiteBeforeShiftAt: row.onsite_before_shift_at,
    };

    const decision = decideArrivalClockIn({
      now,
      card,
      scheduledStart: resolveScheduledStart(row, companyRow),
      earlyArrivalMode: settings.earlyArrivalMode,
      arrivalConfirmationSeconds: resolveArrivalConfirmationSeconds(
        settings,
        companyRow?.jobsite_arrival_confirmation_seconds as number | null | undefined
      ),
      lastExitAt: lastExitByCard.get(row.id) ?? null,
      openElsewhereJobId:
        row.user_id && openElsewhere.get(row.user_id) && openElsewhere.get(row.user_id) !== String(row.job_id ?? "")
          ? (openElsewhere.get(row.user_id) as string)
          : null,
    });

    const outcome = await applyClockInDecision(db, row, decision, now);
    if (outcome === "clocked_in") summary.clockedIn += 1;
    else if (outcome === "backfilled") {
      summary.clockedIn += 1;
      summary.backfilled += 1;
    } else if (outcome === "rejected") summary.rejected += 1;
    else if (outcome === "suppressed") summary.suppressed += 1;
    else if (outcome === "onsite_before_shift") summary.onsiteBeforeShift += 1;
    else summary.waiting += 1;
  }

  return summary;
}
