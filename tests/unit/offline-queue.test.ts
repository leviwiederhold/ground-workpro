import test from "node:test";
import assert from "node:assert/strict";
import {
  backoffDelayMs,
  BACKOFF_MAX_MS,
  classifyFailure,
  dequeue,
  enqueue,
  isDelivered,
  makeEventId,
  markFailure,
  MAX_QUEUE_ATTEMPTS,
  normalizeStoredQueue,
  pruneQuarantined,
  queueDiagnostics,
  selectDueForRetry,
  type NewQueueEvent,
  type QueuedAttendanceEvent,
} from "../../src/lib/attendance/offlineQueue.ts";

const T0 = "2026-07-21T10:50:00.000Z";
const T1 = "2026-07-21T18:00:00.000Z";

function newEvent(over: Partial<NewQueueEvent> = {}): NewQueueEvent {
  return {
    jobId: "job-1",
    assignmentId: "assign-1",
    deviceId: "device-1",
    zone: "arrival",
    transition: "enter",
    occurredAt: T0,
    latitude: 40,
    longitude: -75,
    accuracyMeters: 12,
    ...over,
  };
}

// ── Identity and deduplication ───────────────────────────────────────────────

test("the event id is stable for the same transition in the same minute", () => {
  const a = makeEventId({ jobId: "job-1", zone: "arrival", transition: "enter", occurredAt: T0 });
  const b = makeEventId({
    jobId: "job-1",
    zone: "arrival",
    transition: "enter",
    occurredAt: "2026-07-21T10:50:41.000Z",
  });
  assert.equal(a, b);
});

test("a duplicate native delivery does not queue twice", () => {
  const once = enqueue([], newEvent(), T0);
  const twice = enqueue(once, newEvent(), T0);
  assert.equal(twice.length, 1);
  assert.equal(twice, once); // unchanged reference — nothing was rewritten
});

test("distinct transitions are distinct events", () => {
  let queue = enqueue([], newEvent(), T0);
  queue = enqueue(queue, newEvent({ transition: "exit", occurredAt: T1 }), T1);
  queue = enqueue(queue, newEvent({ jobId: "job-2" }), T0);
  assert.equal(queue.length, 3);
});

// ── Preserved fields ─────────────────────────────────────────────────────────

test("every field the server needs is preserved verbatim", () => {
  const [event] = enqueue([], newEvent(), "2026-07-21T11:00:00.000Z");
  assert.equal(event.occurredAt, T0); // NOT the queued-at time
  assert.equal(event.jobId, "job-1");
  assert.equal(event.assignmentId, "assign-1");
  assert.equal(event.deviceId, "device-1");
  assert.equal(event.latitude, 40);
  assert.equal(event.longitude, -75);
  assert.equal(event.accuracyMeters, 12);
  assert.equal(event.source, "jobsite_auto");
  assert.equal(event.queuedAt, "2026-07-21T11:00:00.000Z");
});

// ── Failure classification ───────────────────────────────────────────────────

test("transport failures and server faults are retryable", () => {
  assert.equal(classifyFailure(null), "retryable"); // offline / DNS / timeout
  assert.equal(classifyFailure(500), "retryable");
  assert.equal(classifyFailure(503), "retryable");
  assert.equal(classifyFailure(429), "retryable");
  assert.equal(classifyFailure(408), "retryable");
});

test("an expired credential is its own class, not a validation failure", () => {
  assert.equal(classifyFailure(401), "auth");
});

test("validation and authorization failures are permanent", () => {
  assert.equal(classifyFailure(422), "permanent"); // bad timestamp / payload
  assert.equal(classifyFailure(403), "permanent"); // not assigned to the job
  assert.equal(classifyFailure(404), "permanent"); // job no longer exists
  assert.equal(classifyFailure(400), "permanent");
});

test("only a 2xx counts as delivered", () => {
  assert.equal(isDelivered(200), true);
  assert.equal(isDelivered(204), true);
  assert.equal(isDelivered(422), false);
  assert.equal(isDelivered(500), false);
});

// ── Backoff ──────────────────────────────────────────────────────────────────

test("backoff grows exponentially and is capped", () => {
  assert.equal(backoffDelayMs(0), 0);
  assert.equal(backoffDelayMs(1), 30_000);
  assert.equal(backoffDelayMs(2), 60_000);
  assert.equal(backoffDelayMs(3), 120_000);
  assert.equal(backoffDelayMs(20), BACKOFF_MAX_MS);
});

test("a retryable failure schedules the next attempt, it does not spin", () => {
  const queue = enqueue([], newEvent(), T0);
  const failed = markFailure(queue, queue[0].eventId, "retryable", "HTTP 503", T0);
  assert.equal(failed[0].attempts, 1);
  assert.equal(failed[0].state, "pending");
  assert.equal(failed[0].nextAttemptAt, "2026-07-21T10:50:30.000Z");
  assert.equal(failed[0].lastError, "HTTP 503");

  // Not due yet — the event is withheld rather than hammered.
  assert.equal(selectDueForRetry(failed, "2026-07-21T10:50:10.000Z").length, 0);
  assert.equal(selectDueForRetry(failed, "2026-07-21T10:51:00.000Z").length, 1);
});

// ── Permanent rejection and the retry ceiling ────────────────────────────────

test("a permanently rejected event is quarantined immediately, not retried", () => {
  const queue = enqueue([], newEvent(), T0);
  const failed = markFailure(queue, queue[0].eventId, "permanent", "HTTP 422", T0);
  assert.equal(failed[0].state, "quarantined");
  assert.equal(failed.length, 1); // kept for diagnosis, not silently deleted
  assert.equal(selectDueForRetry(failed, "2026-08-01T00:00:00.000Z").length, 0);
});

test("a retryable event is quarantined once it exhausts the ceiling", () => {
  let queue = enqueue([], newEvent(), T0);
  const id = queue[0].eventId;
  for (let i = 0; i < MAX_QUEUE_ATTEMPTS - 1; i += 1) {
    queue = markFailure(queue, id, "retryable", "HTTP 500", T0);
    assert.equal(queue[0].state, "pending", `still pending after ${i + 1} attempts`);
  }
  queue = markFailure(queue, id, "retryable", "HTTP 500", T0);
  assert.equal(queue[0].attempts, MAX_QUEUE_ATTEMPTS);
  assert.equal(queue[0].state, "quarantined");
});

test("an expired credential does not burn the retry budget", () => {
  let queue = enqueue([], newEvent(), T0);
  const id = queue[0].eventId;
  // A token that expires overnight would otherwise quarantine a whole day of
  // attendance before anyone could refresh it.
  for (let i = 0; i < MAX_QUEUE_ATTEMPTS + 5; i += 1) {
    queue = markFailure(queue, id, "auth", "HTTP 401", T0);
  }
  assert.equal(queue[0].attempts, 0);
  assert.equal(queue[0].state, "pending");
});

test("after a credential rotation the same event still delivers exactly once", () => {
  let queue = enqueue([], newEvent(), T0);
  const id = queue[0].eventId;
  queue = markFailure(queue, id, "auth", "HTTP 401", T0);
  // Rotation happens out of band; the event is unchanged and still identified
  // by the same stable id, so the server dedupes any overlap.
  assert.equal(queue[0].eventId, id);
  assert.equal(queue[0].occurredAt, T0);
  queue = dequeue(queue, id);
  assert.equal(queue.length, 0);
});

test("quarantined events are pruned only after the retention window", () => {
  const queued = enqueue([], newEvent(), T0);
  const queue = markFailure(queued, queued[0].eventId, "permanent", "HTTP 422", T0);
  assert.equal(pruneQuarantined(queue, "2026-07-28T00:00:00.000Z").length, 1);
  assert.equal(pruneQuarantined(queue, "2026-08-20T00:00:00.000Z").length, 0);
});

test("pruning never drops a pending event, however old", () => {
  const queue = enqueue([], newEvent(), "2020-01-01T00:00:00.000Z");
  assert.equal(pruneQuarantined(queue, "2026-08-20T00:00:00.000Z").length, 1);
});

// ── Ordering ─────────────────────────────────────────────────────────────────

test("an exit never overtakes the enter that opened its shift", () => {
  let queue = enqueue([], newEvent({ transition: "exit", occurredAt: T1 }), T1);
  queue = enqueue(queue, newEvent({ transition: "enter", occurredAt: T0 }), T1);

  // Queued out of order, but only the earlier enter is offered this pass.
  const due = selectDueForRetry(queue, T1);
  assert.equal(due.length, 1);
  assert.equal(due[0].transition, "enter");

  // Once the enter is delivered, the exit becomes the head.
  const after = selectDueForRetry(dequeue(queue, due[0].eventId), T1);
  assert.equal(after.length, 1);
  assert.equal(after[0].transition, "exit");
});

test("different jobs do not block each other", () => {
  let queue = enqueue([], newEvent({ jobId: "job-1" }), T0);
  queue = enqueue(queue, newEvent({ jobId: "job-2" }), T0);
  assert.equal(selectDueForRetry(queue, T1).length, 2);
});

test("a quarantined head does not stall the rest of its job's queue", () => {
  let queue = enqueue([], newEvent({ transition: "enter", occurredAt: T0 }), T0);
  queue = enqueue(queue, newEvent({ transition: "exit", occurredAt: T1 }), T1);
  queue = markFailure(queue, queue[0].eventId, "permanent", "HTTP 422", T0);

  const due = selectDueForRetry(queue, T1);
  assert.equal(due.length, 1);
  assert.equal(due[0].transition, "exit");
});

test("events queued in the same minute keep their insertion order", () => {
  let queue = enqueue([], newEvent({ zone: "wake" }), "2026-07-21T10:50:00.000Z");
  queue = enqueue(queue, newEvent({ zone: "arrival" }), "2026-07-21T10:50:05.000Z");
  const due = selectDueForRetry(queue, T1);
  assert.equal(due[0].zone, "wake");
});

// ── Restart / crash recovery ─────────────────────────────────────────────────

test("a queue written by the previous build is recovered, not discarded", () => {
  // v1 records had no state, nextAttemptAt, assignmentId, deviceId, or source.
  const v1 = [
    {
      eventId: "job-1|arrival|enter|2026-07-21T10:50",
      jobId: "job-1",
      zone: "arrival",
      transition: "enter",
      occurredAt: T0,
      latitude: 40,
      longitude: -75,
      accuracyMeters: 12,
      attempts: 3,
      queuedAt: T0,
    },
  ];
  const recovered = normalizeStoredQueue(v1, T1);
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].occurredAt, T0); // original timestamp intact
  assert.equal(recovered[0].attempts, 3);
  assert.equal(recovered[0].state, "pending");
  // Due immediately: the app just started and this event has been waiting.
  assert.equal(recovered[0].nextAttemptAt, T1);
  assert.equal(selectDueForRetry(recovered, T1).length, 1);
});

test("a v2 envelope round-trips through storage unchanged", () => {
  const queue = enqueue([], newEvent(), T0);
  const roundTripped = normalizeStoredQueue(JSON.parse(JSON.stringify(queue)), T1);
  assert.deepEqual(roundTripped, queue);
});

test("an unreadable entry is dropped without losing the rest of the queue", () => {
  const mixed = [
    null,
    "garbage",
    { jobId: "job-1" }, // no timestamp or transition — unusable
    { jobId: "job-1", occurredAt: "not-a-date", transition: "enter" },
    { jobId: "job-1", occurredAt: T0, transition: "enter", zone: "arrival" },
  ];
  const recovered = normalizeStoredQueue(mixed, T1);
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].occurredAt, T0);
});

test("a corrupted queue yields an empty queue rather than throwing", () => {
  assert.deepEqual(normalizeStoredQueue(null, T1), []);
  assert.deepEqual(normalizeStoredQueue("{{{", T1), []);
  assert.deepEqual(normalizeStoredQueue(42, T1), []);
});

test("duplicate ids in a recovered queue collapse to one", () => {
  const stored = [
    { jobId: "job-1", occurredAt: T0, transition: "enter", zone: "arrival" },
    { jobId: "job-1", occurredAt: "2026-07-21T10:50:30.000Z", transition: "enter", zone: "arrival" },
  ];
  assert.equal(normalizeStoredQueue(stored, T1).length, 1);
});

// ── Diagnostics ──────────────────────────────────────────────────────────────

test("diagnostics report depth, oldest event, last sync, and last failure", () => {
  let queue: QueuedAttendanceEvent[] = enqueue([], newEvent({ transition: "enter", occurredAt: T0 }), T0);
  queue = enqueue(queue, newEvent({ jobId: "job-2", occurredAt: T1 }), T1);
  queue = markFailure(queue, queue[1].eventId, "permanent", "HTTP 422", T1);

  const diagnostics = queueDiagnostics(queue, {
    lastSuccessfulSyncAt: "2026-07-21T09:00:00.000Z",
    lastFailureAt: T1,
    lastFailureReason: "HTTP 422",
  });

  assert.equal(diagnostics.pendingCount, 1);
  assert.equal(diagnostics.quarantinedCount, 1);
  // Oldest by when it HAPPENED, which is what a manager needs to see.
  assert.equal(diagnostics.oldestOccurredAt, T0);
  assert.equal(diagnostics.lastSuccessfulSyncAt, "2026-07-21T09:00:00.000Z");
  assert.equal(diagnostics.lastFailureReason, "HTTP 422");
  assert.equal(diagnostics.nextAttemptAt, T0);
});

test("an empty queue reports empty diagnostics, not nulls that look like failure", () => {
  const diagnostics = queueDiagnostics([]);
  assert.equal(diagnostics.pendingCount, 0);
  assert.equal(diagnostics.quarantinedCount, 0);
  assert.equal(diagnostics.oldestOccurredAt, null);
});
