// Geofence enter/exit → attendance decision engine (pure).
//
// The third member of the decision layer, alongside decideArrivalClockIn() and
// decideClockOut(). Those two answer "is this pending arrival/departure ready to
// become a clock-in/out?". This one answers the question that comes first: "a
// transition just arrived — what should the record look like now?"
//
// It previously lived inline in app/api/jobsite-time/events/route.ts, which made
// the HTTP handler the only place several rules existed — most importantly the
// Job A → Job B transfer. Nothing here touches the database: the decision names
// the effects, applyGeofenceDecision() performs them.
//
// The rules encoded below, in the order they matter:
//  1. an automatic event that failed server-side validation never reaches the
//     record — but a MANUAL event is never gated, because manual is the fallback
//     for exactly the conditions that make validation fail;
//  2. arriving at job B resolves whatever job A left open, so a day can never be
//     double-counted across two jobsites;
//  3. a brief exit is not a departure, and a return inside the grace period
//     cancels it outright;
//  4. the EARLIEST observed exit wins, so an offline queue flushing out of order
//     can only ever move a departure back to when it really happened;
//  5. every transition is logged whether or not it changed anything — a stream
//     of exits from someone who was never clocked in must be visible, not
//     silently dropped.

import type { AttendanceArrivalStatus, TimecardConfidence } from "../jobsite-time/domain.ts";

export type GeofenceTransition = "enter" | "exit";

// "manual" is the employee-operated fallback; "jobsite_auto" is anything the
// automatic pipeline produced (native geofence, foreground pass, offline flush).
export type GeofenceEventSource = "jobsite_auto" | "manual";

/** Today's record for the job the event fired at. */
export type GeofenceCard = {
  id: string;
  jobId: string | null;
  status: string | null;
  clockInAt: string | null;
  clockOutAt: string | null;
  pendingArrivalAt: string | null;
  pendingDepartureAt: string | null;
  detectedDepartureAt: string | null;
};

/** An open record at some OTHER job on the same work date. */
export type OtherOpenCard = {
  id: string;
  jobId: string | null;
  clockInAt: string | null;
  pendingArrivalAt: string | null;
  pendingDepartureAt: string | null;
};

/** The verdict from evaluateJobsiteEvent(), narrowed to what this engine uses. */
export type GeofenceEvaluation = {
  reject: boolean;
  ignore?: boolean;
  reason?: string;
  confidence: TimecardConfidence;
  needsReview: boolean;
  arrivalStatus: AttendanceArrivalStatus | null;
};

export type GeofenceEventInput = {
  transition: GeofenceTransition;
  // When the transition happened on the device — NOT when it reached us.
  occurredAt: string;
  source: GeofenceEventSource;
  evaluation: GeofenceEvaluation;
  card: GeofenceCard | null;
  otherOpenCards: OtherOpenCard[];
  departureGraceMinutes: number;
  // Retained for wire compatibility with the legacy company setting. Clean
  // automatic sessions no longer use it; exceptions carry needs_review.
  requireApproval: boolean;
};

// ── Effects ──────────────────────────────────────────────────────────────────

/** An audit row to append. `target` is resolved by the applier. */
export type EventDraft = {
  // "primary" = the card this event's job owns, whose id may not exist until
  // the primary effect has been applied. "none" = an event with no card at all.
  target: { kind: "primary" } | { kind: "card"; timecardId: string; jobId: string | null };
  eventType: string;
  occurredAt: string;
  validationResult: "accepted" | "rejected" | "ignored" | "suppressed";
  validationReason: string | null;
  notes?: string;
  // Attach the reported coordinates. Only the raw transition events carry them;
  // derived events (departure_pending, departure_cancelled) do not.
  withLocation?: boolean;
  // Skip this row if the guarded primary update matched nothing — another
  // writer got there first and the event would describe a change we did not make.
  requiresPrimaryApplied?: boolean;
};

/** Resolution of a record left open at a different job. */
export type TransferEffect = {
  timecardId: string;
  jobId: string | null;
  // "cancel_pending_arrival": never actually confirmed arrived there.
  // "begin_departure": was working there; treat arriving here as leaving there.
  kind: "cancel_pending_arrival" | "begin_departure";
  departureAt?: string;
  event: EventDraft | null;
};

export type PrimaryEffect =
  | { kind: "none" }
  | {
      kind: "open_session";
      pendingArrivalAt: string;
      arrivalStatus: AttendanceArrivalStatus | null;
      status: string;
      confidence: TimecardConfidence;
    }
  | {
      kind: "record_arrival";
      timecardId: string;
      pendingArrivalAt: string;
      arrivalStatus: AttendanceArrivalStatus | null;
      confidence: TimecardConfidence;
    }
  | { kind: "cancel_departure"; timecardId: string }
  | { kind: "cancel_pending_arrival"; timecardId: string }
  | {
      kind: "begin_departure";
      timecardId: string;
      departureAt: string;
      detectedDepartureAt: string;
      confidence: TimecardConfidence;
      status: string | null;
    };

export type GeofenceResponse =
  | { kind: "ok" }
  | { kind: "ignored"; reason: string }
  | { kind: "error"; status: number; message: string };

export type GeofenceDecision = {
  // Applied first, in order: an arrival elsewhere is resolved before this job's
  // record changes, so the two can never both be open.
  transfers: TransferEffect[];
  primary: PrimaryEffect;
  // Appended after the primary effect, in order.
  events: EventDraft[];
  response: GeofenceResponse;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * The earliest of two timestamps, tolerating nulls.
 *
 * This is what makes an out-of-order or offline event able to move a departure
 * EARLIER (to when it actually happened) but never later.
 */
export function earliestIso(a: string | null | undefined, b: string): string {
  if (!a) return b;
  const aMs = Date.parse(a);
  const bMs = Date.parse(b);
  if (!Number.isFinite(aMs)) return b;
  if (!Number.isFinite(bMs)) return a;
  return aMs <= bMs ? a : b;
}

const nothing = (response: GeofenceResponse, events: EventDraft[] = []): GeofenceDecision => ({
  transfers: [],
  primary: { kind: "none" },
  events,
  response,
});

// ── The engine ───────────────────────────────────────────────────────────────

/**
 * Decide what a geofence transition does to the attendance record.
 *
 * Pure: no clock, no database, no HTTP. `occurredAt` is the only notion of time
 * it has, deliberately — whether a pending arrival or departure has *matured*
 * is decideArrivalClockIn()/decideClockOut()'s job, and those run against real
 * time so a delayed event cannot stall a due clock-in.
 */
export function decideGeofenceEvent(input: GeofenceEventInput): GeofenceDecision {
  const auto = input.source === "jobsite_auto";
  const { evaluation } = input;

  // 1. Validation gates the automatic path only. A manual event is the fallback
  //    for an unverified address or a bad fix, so rejecting it on those same
  //    grounds would leave the employee no way to record the day.
  if (auto && evaluation.reject) {
    return nothing({ kind: "error", status: 422, message: evaluation.reason || "Invalid jobsite event" });
  }
  if (auto && evaluation.ignore) {
    return nothing({
      kind: "ignored",
      reason: evaluation.reason || "Event is outside the company's attendance tracking window",
    });
  }

  return input.transition === "enter" ? decideEnter(input) : decideExit(input);
}

function decideEnter(input: GeofenceEventInput): GeofenceDecision {
  const { card, evaluation, occurredAt } = input;
  const events: EventDraft[] = [];

  // 2. Arriving here resolves anything still open elsewhere today. Without this
  //    an employee who moves from job A to job B accrues hours at both.
  const transfers: TransferEffect[] = [];
  for (const other of input.otherOpenCards) {
    if (!other.clockInAt) {
      // Never confirmed arrived there — drop the pending arrival rather than
      // recording a departure that never happened.
      if (other.pendingArrivalAt) {
        transfers.push({
          timecardId: other.id,
          jobId: other.jobId,
          kind: "cancel_pending_arrival",
          event: null,
        });
      }
      continue;
    }
    // Already leaving; let the normal grace period finalize it.
    if (other.pendingDepartureAt) continue;
    transfers.push({
      timecardId: other.id,
      jobId: other.jobId,
      kind: "begin_departure",
      departureAt: occurredAt,
      event: {
        target: { kind: "card", timecardId: other.id, jobId: other.jobId },
        eventType: "exited_geofence",
        occurredAt,
        validationResult: "accepted",
        validationReason: "arrived_at_another_job",
        notes: "Employee arrived at another assigned job",
      },
    });
  }

  // A validated automatic arrival is normal attendance, not a review task.
  // Manual/fallback attendance needs review because it represents an
  // employee-entered boundary rather than an observed native transition.
  const openStatus = input.source === "manual" ? "needs_review" : "active";
  let primary: PrimaryEffect;

  if (!card || (card.clockInAt && card.clockOutAt)) {
    // No record for this job today, or the last one already closed (a lunch
    // break that finalized past the grace period). Returning to the same job
    // later the same day starts a new session rather than being a no-op.
    primary = {
      kind: "open_session",
      pendingArrivalAt: occurredAt,
      arrivalStatus: evaluation.arrivalStatus,
      status: evaluation.needsReview ? "needs_review" : openStatus,
      confidence: evaluation.confidence,
    };
  } else if (card.clockInAt && card.pendingDepartureAt) {
    // 3. A return inside the grace period cancels the departure. Checked
    //    against the RE-ENTRY's own timestamp, not the current time, so a
    //    delayed event cannot revive a departure that already finalized.
    const graceEndsMs =
      Date.parse(card.pendingDepartureAt) + Math.max(0, input.departureGraceMinutes) * 60_000;
    if (Date.parse(occurredAt) <= graceEndsMs) {
      primary = { kind: "cancel_departure", timecardId: card.id };
      events.push({
        target: { kind: "primary" },
        eventType: "departure_cancelled",
        occurredAt,
        validationResult: "accepted",
        validationReason: null,
        notes: "Employee returned to the jobsite during the departure grace period",
        requiresPrimaryApplied: true,
      });
    } else {
      primary = { kind: "none" };
    }
  } else if (!card.clockInAt) {
    // Awaiting arrival confirmation. Keep the ORIGINAL pending arrival — the
    // dwell period runs from when they first got here, not from the latest
    // duplicate delivery of the same transition.
    primary = {
      kind: "record_arrival",
      timecardId: card.id,
      pendingArrivalAt: card.pendingArrivalAt ?? occurredAt,
      arrivalStatus: evaluation.arrivalStatus,
      confidence: evaluation.confidence,
    };
  } else {
    // Already clocked in with no pending departure — a duplicate enter.
    primary = { kind: "none" };
  }

  // 5. The transition is always recorded, even when it changed nothing.
  events.push({
    target: { kind: "primary" },
    eventType: "entered_geofence",
    occurredAt,
    validationResult: "accepted",
    validationReason: evaluation.arrivalStatus ?? null,
    withLocation: true,
  });

  return { transfers, primary, events, response: { kind: "ok" } };
}

function decideExit(input: GeofenceEventInput): GeofenceDecision {
  const { card, evaluation, occurredAt } = input;
  const auto = input.source === "jobsite_auto";
  const events: EventDraft[] = [];

  if (!card) {
    // Nothing to close. Audited without a card so a stream of exits from
    // someone who was never clocked in is visible rather than dropped.
    return nothing(
      auto
        ? { kind: "ignored", reason: "no_open_timecard" }
        : { kind: "error", status: 409, message: "No open jobsite time to close" },
      [
        {
          target: { kind: "card", timecardId: "", jobId: null },
          eventType: "clock_out_rejected",
          occurredAt,
          validationResult: "rejected",
          validationReason: "no_open_timecard",
          notes: "Exit event with no open timecard for this job and work date",
        },
      ]
    );
  }

  let primary: PrimaryEffect;

  if (!card.clockInAt && card.pendingArrivalAt) {
    // Left before the arrival confirmation elapsed — the arrival never counted.
    primary = { kind: "cancel_pending_arrival", timecardId: card.id };
  } else if (card.clockInAt && !card.clockOutAt) {
    // 4. The ORIGINAL validated departure anchors both the grace period and the
    //    eventual clock-out timestamp, so the earliest observed exit wins.
    const departureAt = earliestIso(card.pendingDepartureAt, occurredAt);
    const alreadyPending = Boolean(card.pendingDepartureAt);
    primary = {
      kind: "begin_departure",
      timecardId: card.id,
      departureAt,
      detectedDepartureAt: earliestIso(card.detectedDepartureAt, occurredAt),
      confidence: evaluation.confidence,
      status: evaluation.needsReview ? "needs_review" : card.status,
    };
    // The grace period starts once, on the first exit — a duplicate native
    // delivery must not re-log it.
    if (!alreadyPending) {
      events.push({
        target: { kind: "primary" },
        eventType: "departure_pending",
        occurredAt: departureAt,
        validationResult: "accepted",
        validationReason: null,
        notes: `Departure grace period started (${input.departureGraceMinutes} min)`,
        requiresPrimaryApplied: true,
      });
    }
  } else {
    primary = { kind: "none" };
  }

  events.push({
    target: { kind: "primary" },
    eventType: "exited_geofence",
    occurredAt,
    validationResult: "accepted",
    validationReason: null,
    withLocation: true,
  });

  return { transfers: [], primary, events, response: { kind: "ok" } };
}
