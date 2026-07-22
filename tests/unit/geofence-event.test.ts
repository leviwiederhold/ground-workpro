import test from "node:test";
import assert from "node:assert/strict";
import {
  decideGeofenceEvent,
  earliestIso,
  type GeofenceCard,
  type GeofenceEventInput,
} from "../../src/lib/attendance/geofenceEvent.ts";

// 7:00 AM – 4:00 PM shift, America/New_York in July (UTC-4).
const ARRIVED = "2026-07-21T11:00:00.000Z"; // 7:00 AM local
const EXITED = "2026-07-21T18:00:00.000Z"; // 2:00 PM local

function card(over: Partial<GeofenceCard> = {}): GeofenceCard {
  return {
    id: "tc-1",
    jobId: "job-1",
    status: "active",
    clockInAt: null,
    clockOutAt: null,
    pendingArrivalAt: null,
    pendingDepartureAt: null,
    detectedDepartureAt: null,
    ...over,
  };
}

function input(over: Partial<GeofenceEventInput> = {}): GeofenceEventInput {
  return {
    transition: "enter",
    occurredAt: ARRIVED,
    source: "jobsite_auto",
    evaluation: {
      reject: false,
      confidence: "high",
      needsReview: false,
      arrivalStatus: "on_time",
    },
    card: null,
    otherOpenCards: [],
    departureGraceMinutes: 10,
    requireApproval: false,
    ...over,
  };
}

const eventTypes = (d: ReturnType<typeof decideGeofenceEvent>) => d.events.map((e) => e.eventType);

// ── Automatic arrival ────────────────────────────────────────────────────────

test("arriving with no record opens a session awaiting confirmation", () => {
  const d = decideGeofenceEvent(input());
  assert.equal(d.primary.kind, "open_session");
  // The arrival is PENDING — decideArrivalClockIn() turns it into a clock-in
  // once the dwell period has actually elapsed. Opening the session must never
  // clock anyone in by itself.
  assert.equal(d.primary.kind === "open_session" && d.primary.pendingArrivalAt, ARRIVED);
  assert.equal(d.primary.kind === "open_session" && d.primary.status, "active");
  assert.deepEqual(eventTypes(d), ["entered_geofence"]);
});

test("a company that requires approval opens the session as pending_review", () => {
  const d = decideGeofenceEvent(input({ requireApproval: true }));
  assert.equal(d.primary.kind === "open_session" && d.primary.status, "pending_review");
});

test("a questionable arrival opens the session as needs_review", () => {
  const d = decideGeofenceEvent(
    input({
      requireApproval: true,
      evaluation: { reject: false, confidence: "low", needsReview: true, arrivalStatus: "late" },
    })
  );
  // needs_review outranks the approval default — a manager has to look at it.
  assert.equal(d.primary.kind === "open_session" && d.primary.status, "needs_review");
});

test("returning to the same job after a closed session starts a new one", () => {
  const d = decideGeofenceEvent(
    input({
      occurredAt: "2026-07-21T19:00:00.000Z",
      card: card({ clockInAt: ARRIVED, clockOutAt: EXITED }),
    })
  );
  assert.equal(d.primary.kind, "open_session");
});

test("an arrival at a job already awaiting confirmation keeps the ORIGINAL time", () => {
  // The dwell period runs from when they first got here. A duplicate delivery
  // of the same transition must not restart the clock.
  const d = decideGeofenceEvent(
    input({
      occurredAt: "2026-07-21T11:04:00.000Z",
      card: card({ pendingArrivalAt: ARRIVED }),
    })
  );
  assert.equal(d.primary.kind, "record_arrival");
  assert.equal(d.primary.kind === "record_arrival" && d.primary.pendingArrivalAt, ARRIVED);
});

// ── Duplicate events ─────────────────────────────────────────────────────────

test("a duplicate enter while already clocked in changes nothing but is still logged", () => {
  const d = decideGeofenceEvent(input({ card: card({ clockInAt: ARRIVED }) }));
  assert.equal(d.primary.kind, "none");
  // Logged anyway: the trail has to show what the device reported, including
  // the transitions that had no effect.
  assert.deepEqual(eventTypes(d), ["entered_geofence"]);
});

test("a duplicate exit does not restart the grace period or re-log it", () => {
  const d = decideGeofenceEvent(
    input({
      transition: "exit",
      occurredAt: "2026-07-21T18:03:00.000Z",
      card: card({ clockInAt: ARRIVED, pendingDepartureAt: EXITED, detectedDepartureAt: EXITED }),
    })
  );
  assert.equal(d.primary.kind, "begin_departure");
  // Still anchored to the FIRST exit, and departure_pending is not repeated.
  assert.equal(d.primary.kind === "begin_departure" && d.primary.departureAt, EXITED);
  assert.deepEqual(eventTypes(d), ["exited_geofence"]);
});

// ── Automatic departure ──────────────────────────────────────────────────────

test("exiting while clocked in opens the departure grace period", () => {
  const d = decideGeofenceEvent(
    input({ transition: "exit", occurredAt: EXITED, card: card({ clockInAt: ARRIVED }) })
  );
  assert.equal(d.primary.kind, "begin_departure");
  assert.equal(d.primary.kind === "begin_departure" && d.primary.departureAt, EXITED);
  assert.deepEqual(eventTypes(d), ["departure_pending", "exited_geofence"]);
});

test("an out-of-order offline exit moves the departure EARLIER, never later", () => {
  // The queue flushed a 14:00 exit after a 14:20 one had already landed. The
  // employee left at 14:00; the record must say so.
  const d = decideGeofenceEvent(
    input({
      transition: "exit",
      occurredAt: EXITED,
      card: card({
        clockInAt: ARRIVED,
        pendingDepartureAt: "2026-07-21T18:20:00.000Z",
        detectedDepartureAt: "2026-07-21T18:20:00.000Z",
      }),
    })
  );
  assert.equal(d.primary.kind === "begin_departure" && d.primary.departureAt, EXITED);
  assert.equal(d.primary.kind === "begin_departure" && d.primary.detectedDepartureAt, EXITED);
});

test("a later duplicate exit does not push the departure forward", () => {
  const d = decideGeofenceEvent(
    input({
      transition: "exit",
      occurredAt: "2026-07-21T18:20:00.000Z",
      card: card({ clockInAt: ARRIVED, pendingDepartureAt: EXITED, detectedDepartureAt: EXITED }),
    })
  );
  assert.equal(d.primary.kind === "begin_departure" && d.primary.departureAt, EXITED);
});

test("leaving before the arrival was confirmed cancels it", () => {
  const d = decideGeofenceEvent(
    input({
      transition: "exit",
      occurredAt: "2026-07-21T11:02:00.000Z",
      card: card({ pendingArrivalAt: ARRIVED }),
    })
  );
  assert.equal(d.primary.kind, "cancel_pending_arrival");
});

test("an exit with nothing open is ignored but still audited", () => {
  const d = decideGeofenceEvent(input({ transition: "exit", card: null }));
  assert.equal(d.primary.kind, "none");
  assert.deepEqual(d.response, { kind: "ignored", reason: "no_open_timecard" });
  // A stream of these is a real signal that something is wrong on the device.
  assert.deepEqual(eventTypes(d), ["clock_out_rejected"]);
});

test("a MANUAL exit with nothing open is an error, not a silent ignore", () => {
  const d = decideGeofenceEvent(input({ transition: "exit", card: null, source: "manual" }));
  assert.deepEqual(d.response, { kind: "error", status: 409, message: "No open jobsite time to close" });
});

// ── Brief exits are not departures ───────────────────────────────────────────

test("returning inside the grace period cancels the departure", () => {
  const d = decideGeofenceEvent(
    input({
      occurredAt: "2026-07-21T18:05:00.000Z",
      card: card({ clockInAt: ARRIVED, pendingDepartureAt: EXITED }),
    })
  );
  assert.equal(d.primary.kind, "cancel_departure");
  assert.deepEqual(eventTypes(d), ["departure_cancelled", "entered_geofence"]);
});

test("returning AFTER the grace period does not cancel a confirmed departure", () => {
  const d = decideGeofenceEvent(
    input({
      occurredAt: "2026-07-21T18:30:00.000Z",
      card: card({ clockInAt: ARRIVED, pendingDepartureAt: EXITED }),
    })
  );
  assert.equal(d.primary.kind, "none");
  assert.deepEqual(eventTypes(d), ["entered_geofence"]);
});

test("the grace window is measured from the RE-ENTRY's own timestamp", () => {
  // A delayed event that reaches us at 3 PM but happened at 14:05 still counts
  // as a return inside the window; processing time is irrelevant.
  const d = decideGeofenceEvent(
    input({
      occurredAt: "2026-07-21T18:09:59.000Z",
      card: card({ clockInAt: ARRIVED, pendingDepartureAt: EXITED }),
      departureGraceMinutes: 10,
    })
  );
  assert.equal(d.primary.kind, "cancel_departure");
});

// ── Transfer between jobs ────────────────────────────────────────────────────

test("arriving at job B closes an open session at job A", () => {
  const d = decideGeofenceEvent(
    input({
      occurredAt: "2026-07-21T15:00:00.000Z",
      otherOpenCards: [
        { id: "tc-a", jobId: "job-a", clockInAt: ARRIVED, pendingArrivalAt: null, pendingDepartureAt: null },
      ],
    })
  );
  assert.equal(d.transfers.length, 1);
  assert.equal(d.transfers[0].kind, "begin_departure");
  assert.equal(d.transfers[0].timecardId, "tc-a");
  assert.equal(d.transfers[0].departureAt, "2026-07-21T15:00:00.000Z");
  // Audited against job A with the reason, so the hours at A end where B begins.
  assert.equal(d.transfers[0].event?.validationReason, "arrived_at_another_job");
  // And job B opens in the same decision — no manual clock out/in anywhere.
  assert.equal(d.primary.kind, "open_session");
});

test("an unconfirmed arrival at job A is cancelled, not turned into a departure", () => {
  // They never actually stopped at A. Recording a departure there would invent
  // a shift that never happened.
  const d = decideGeofenceEvent(
    input({
      otherOpenCards: [
        { id: "tc-a", jobId: "job-a", clockInAt: null, pendingArrivalAt: ARRIVED, pendingDepartureAt: null },
      ],
    })
  );
  assert.equal(d.transfers.length, 1);
  assert.equal(d.transfers[0].kind, "cancel_pending_arrival");
  assert.equal(d.transfers[0].event, null);
});

test("a job already resolving its own departure is left alone", () => {
  const d = decideGeofenceEvent(
    input({
      otherOpenCards: [
        { id: "tc-a", jobId: "job-a", clockInAt: ARRIVED, pendingArrivalAt: null, pendingDepartureAt: EXITED },
      ],
    })
  );
  // Its grace period is already running; interfering would move the departure.
  assert.deepEqual(d.transfers, []);
});

test("a job with neither an arrival nor a clock-in produces no transfer", () => {
  const d = decideGeofenceEvent(
    input({
      otherOpenCards: [
        { id: "tc-a", jobId: "job-a", clockInAt: null, pendingArrivalAt: null, pendingDepartureAt: null },
      ],
    })
  );
  assert.deepEqual(d.transfers, []);
});

// ── Validation gates the automatic path only ─────────────────────────────────

test("a rejected automatic event never reaches the record", () => {
  const d = decideGeofenceEvent(
    input({
      evaluation: {
        reject: true,
        reason: "Location is not at the jobsite",
        confidence: "low",
        needsReview: true,
        arrivalStatus: null,
      },
    })
  );
  assert.deepEqual(d.response, { kind: "error", status: 422, message: "Location is not at the jobsite" });
  assert.equal(d.primary.kind, "none");
  assert.deepEqual(d.events, []);
});

test("an ignored automatic event is not recorded", () => {
  const d = decideGeofenceEvent(
    input({
      evaluation: {
        reject: false,
        ignore: true,
        reason: "Outside the tracking window",
        confidence: "high",
        needsReview: false,
        arrivalStatus: null,
      },
    })
  );
  assert.deepEqual(d.response, { kind: "ignored", reason: "Outside the tracking window" });
  assert.equal(d.primary.kind, "none");
});

test("a MANUAL event is never gated by the same validation", () => {
  // Manual is the fallback for exactly the conditions that make validation
  // fail — an unverified address, a bad fix, no schedule. Rejecting it here
  // would leave the employee no way to record the day at all.
  const d = decideGeofenceEvent(
    input({
      source: "manual",
      evaluation: {
        reject: true,
        ignore: true,
        reason: "Location is not at the jobsite",
        confidence: "low",
        needsReview: true,
        arrivalStatus: null,
      },
    })
  );
  assert.deepEqual(d.response, { kind: "ok" });
  assert.equal(d.primary.kind, "open_session");
});

// ── earliestIso ──────────────────────────────────────────────────────────────

test("earliestIso prefers the earlier timestamp and tolerates nulls", () => {
  assert.equal(earliestIso(null, EXITED), EXITED);
  assert.equal(earliestIso(EXITED, "2026-07-21T18:20:00.000Z"), EXITED);
  assert.equal(earliestIso("2026-07-21T18:20:00.000Z", EXITED), EXITED);
  assert.equal(earliestIso("not-a-date", EXITED), EXITED);
});
