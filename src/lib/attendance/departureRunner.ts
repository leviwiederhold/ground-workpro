/* eslint-disable @typescript-eslint/no-explicit-any */
// Server-side scheduled reconciliation for automatic departure → clock-out.
//
// The mirror of scheduledClockInRunner.ts, and for the same reason: with the app
// closed nothing in the WebView runs, so the grace period cannot be enforced by
// a timer on the phone. This pass runs on the server every minute, confirms
// departures whose grace period has elapsed, cancels departures the employee
// returned from, and closes out shifts whose exit event never arrived.
//
// Every clock-out is written at the ORIGINAL validated departure time and
// guarded by `.is("clock_out_at", null)`, so a delayed, offline, or duplicated
// confirmation produces exactly one record with the same timestamps.

import {
  mapRowToAttendanceSettings,
  resolveDepartureGraceMinutes,
  type AutomaticAttendanceSettings,
} from "./attendanceSettings.ts";
import { decideClockOut, type ClockOutAction, type DepartureCard } from "./departure.ts";
import { resolveCompanyWorkSchedule, type CompanyConfigRow } from "../company/companyConfig.ts";
import { computeTotalMinutes, scheduledWindowForWorkDate } from "../jobsite-time/domain.ts";

const COMPANY_COLUMNS =
  "id,timezone,default_work_days,default_work_start_time,default_work_end_time," +
  "attendance_automatic_enabled,attendance_departure_grace_minutes," +
  "attendance_end_of_day_cutoff_minutes,jobsite_departure_grace_minutes";

const CANDIDATE_COLUMNS =
  "id,company_id,job_id,employee_id,user_id,work_date,scheduled_start,scheduled_end," +
  "clock_in_at,clock_out_at,break_start_at,break_end_at,pending_departure_at," +
  "detected_departure_at,status,monitoring_stopped_at";

// Two days covers overnight shifts plus a scheduler outage.
const LOOKBACK_DAYS = 2;

export type DepartureSummary = {
  candidates: number;
  clockedOut: number;
  fallbackClockedOut: number;
  cancelled: number;
  holding: number;
  suppressed: number;
  monitoringStopped: number;
  companies: number;
};

type OpenCardRow = {
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
  pending_departure_at: string | null;
  detected_departure_at: string | null;
  status: string | null;
  monitoring_stopped_at: string | null;
};

function emptySummary(): DepartureSummary {
  return {
    candidates: 0,
    clockedOut: 0,
    fallbackClockedOut: 0,
    cancelled: 0,
    holding: 0,
    suppressed: 0,
    monitoringStopped: 0,
    companies: 0,
  };
}

function lookbackWorkDate(now: Date): string {
  return new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Scheduled end for a card: the stored value, else the company work hours. */
export function resolveScheduledEnd(
  row: Pick<OpenCardRow, "scheduled_end" | "work_date">,
  companyRow: Record<string, unknown> | null
): string | null {
  if (row.scheduled_end) return row.scheduled_end;
  if (!row.work_date) return null;
  const schedule = resolveCompanyWorkSchedule(companyRow as unknown as CompanyConfigRow | null);
  if (!schedule) return null;
  return scheduledWindowForWorkDate(row.work_date, schedule).scheduledEnd;
}

async function logEvent(
  db: any,
  row: OpenCardRow,
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
 * Apply one clock-out decision. Shared by the scheduled pass and the
 * opportunistic foreground pass so both write and audit identically.
 */
export async function applyClockOutDecision(
  db: any,
  row: OpenCardRow,
  decision: ClockOutAction,
  now: string
): Promise<"clocked_out" | "fallback_clocked_out" | "cancelled" | "holding" | "suppressed" | "skipped"> {
  if (decision.action === "skip") {
    return decision.reason === "already_clocked_out" ? "suppressed" : "skipped";
  }

  if (decision.action === "hold") return "holding";

  if (decision.action === "cancel_departure") {
    const cleared = await db
      .from("jobsite_timecards")
      .update({ pending_departure_at: null, detected_departure_at: null })
      .eq("id", row.id)
      .eq("company_id", row.company_id)
      .is("clock_out_at", null)
      .not("pending_departure_at", "is", null)
      .select("id")
      .maybeSingle();
    if (!cleared.data) return "suppressed";
    await logEvent(
      db,
      row,
      "departure_cancelled",
      decision.returnedAt,
      "Employee returned to the jobsite during the departure grace period"
    );
    return "cancelled";
  }

  // clock_out. The total is computed against the ORIGINAL departure time, so a
  // delayed confirmation cannot inflate the hours.
  const fallback = decision.method === "fallback_end_of_day";
  const totalMinutes = computeTotalMinutes({ ...row, clock_out_at: decision.effectiveAt });
  const update: Record<string, unknown> = {
    clock_out_at: decision.effectiveAt,
    detected_departure_at: row.detected_departure_at ?? (fallback ? null : decision.effectiveAt),
    pending_departure_at: null,
    total_minutes: totalMinutes,
    clock_out_method: decision.method,
    // Monitoring stops for this assignment the moment the day is resolved.
    monitoring_stopped_at: now,
  };
  // A shift closed without a real exit event is a guess at the boundary, not an
  // observation — it must never look like a verified departure.
  if (fallback) update.status = "needs_review";

  const applied = await db
    .from("jobsite_timecards")
    .update(update)
    .eq("id", row.id)
    .eq("company_id", row.company_id)
    .is("clock_out_at", null)
    .select("id")
    .maybeSingle();

  if (!applied.data) {
    await logEvent(db, row, "duplicate_suppressed", now, "Clock-out already applied by another writer");
    return "suppressed";
  }

  if (fallback) {
    await logEvent(
      db,
      row,
      "fallback_clock_out",
      decision.effectiveAt,
      `No departure event was received; closed at the scheduled end (processed at ${now})`
    );
  } else {
    await logEvent(db, row, "auto_clock_out", decision.effectiveAt, "Departure grace period elapsed");
  }
  await logEvent(db, row, "monitoring_stopped", now, "Workday resolved; monitoring stopped for this assignment");
  return fallback ? "fallback_clocked_out" : "clocked_out";
}

export async function runScheduledAttendanceClockOut({
  db,
  now = new Date().toISOString(),
  companyId,
  limit = 500,
}: {
  db: any;
  now?: string;
  companyId?: string | null;
  limit?: number;
}): Promise<DepartureSummary> {
  const summary = emptySummary();
  const since = lookbackWorkDate(new Date(now));

  // Every OPEN clocked-in card is a candidate: those with a pending departure
  // may be due, and those without one may need the end-of-day fallback.
  let query = db
    .from("jobsite_timecards")
    .select(CANDIDATE_COLUMNS)
    .not("clock_in_at", "is", null)
    .is("clock_out_at", null)
    .gte("work_date", since)
    .order("clock_in_at", { ascending: true })
    .limit(limit);
  if (companyId) query = query.eq("company_id", companyId);

  const candidates = await query;
  if (candidates.error) throw new Error(candidates.error.message);
  const rows = (candidates.data ?? []) as OpenCardRow[];
  summary.candidates = rows.length;
  if (rows.length === 0) return summary;

  const companyIds = Array.from(new Set(rows.map((r) => r.company_id)));
  summary.companies = companyIds.length;

  const companiesResult = await db.from("companies").select(COMPANY_COLUMNS).in("id", companyIds);
  const companyById = new Map<string, Record<string, unknown>>();
  for (const row of (companiesResult.data ?? []) as Array<Record<string, unknown>>) {
    companyById.set(String(row.id), row);
  }

  // Re-entries that arrived after the exit (including a late offline flush) —
  // these cancel a pending departure even if the enter event was processed out
  // of order.
  const entersResult = await db
    .from("jobsite_timecard_events")
    .select("timecard_id,occurred_at")
    .in(
      "timecard_id",
      rows.map((r) => r.id)
    )
    .eq("event_type", "entered_geofence")
    .order("occurred_at", { ascending: false })
    .limit(1000);
  const lastEnterByCard = new Map<string, string>();
  for (const event of (entersResult.data ?? []) as Array<{ timecard_id: string; occurred_at: string }>) {
    if (!lastEnterByCard.has(event.timecard_id)) lastEnterByCard.set(event.timecard_id, event.occurred_at);
  }

  for (const row of rows) {
    const companyRow = companyById.get(row.company_id) ?? null;
    const settings: AutomaticAttendanceSettings = mapRowToAttendanceSettings(companyRow);
    if (!settings.automaticAttendanceEnabled) continue;

    const card: DepartureCard = {
      clockInAt: row.clock_in_at,
      clockOutAt: row.clock_out_at,
      pendingDepartureAt: row.pending_departure_at,
    };

    const decision = decideClockOut({
      now,
      card,
      departureGraceMinutes: resolveDepartureGraceMinutes(
        settings,
        companyRow?.jobsite_departure_grace_minutes as number | null | undefined
      ),
      lastEnterAt: lastEnterByCard.get(row.id) ?? null,
      scheduledEnd: resolveScheduledEnd(row, companyRow),
      endOfDayCutoffMinutes: settings.endOfDayCutoffMinutes,
    });

    const outcome = await applyClockOutDecision(db, row, decision, now);
    if (outcome === "clocked_out") {
      summary.clockedOut += 1;
      summary.monitoringStopped += 1;
    } else if (outcome === "fallback_clocked_out") {
      summary.clockedOut += 1;
      summary.fallbackClockedOut += 1;
      summary.monitoringStopped += 1;
    } else if (outcome === "cancelled") summary.cancelled += 1;
    else if (outcome === "holding") summary.holding += 1;
    else if (outcome === "suppressed") summary.suppressed += 1;
  }

  return summary;
}
