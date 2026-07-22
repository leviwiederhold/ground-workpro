import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_QUEUE_ATTEMPTS,
  dequeue,
  enqueue,
  makeEventId,
  markAttempt,
  pruneExhausted,
  selectDueForRetry,
  type QueuedAttendanceEvent,
} from "../../src/lib/attendance/offlineQueue.ts";

const ev = (over: Partial<Parameters<typeof enqueue>[1]> = {}) => ({
  jobId: "job-1",
  zone: "arrival" as const,
  transition: "enter" as const,
  occurredAt: "2026-07-20T14:00:10.000Z",
  latitude: 40,
  longitude: -75,
  accuracyMeters: 10,
  ...over,
});

test("makeEventId collapses same-minute duplicates and separates distinct events", () => {
  const a = makeEventId({ jobId: "j", zone: "arrival", transition: "enter", occurredAt: "2026-07-20T14:00:10Z" });
  const b = makeEventId({ jobId: "j", zone: "arrival", transition: "enter", occurredAt: "2026-07-20T14:00:59Z" });
  assert.equal(a, b);
  assert.notEqual(a, makeEventId({ jobId: "j", zone: "arrival", transition: "exit", occurredAt: "2026-07-20T14:00:10Z" }));
});

test("enqueue is idempotent on the stable event id (no duplicate submissions)", () => {
  let q: QueuedAttendanceEvent[] = [];
  q = enqueue(q, ev());
  q = enqueue(q, ev({ occurredAt: "2026-07-20T14:00:45.000Z" })); // same minute → same id
  assert.equal(q.length, 1);
  q = enqueue(q, ev({ transition: "exit" }));
  assert.equal(q.length, 2);
});

test("enqueue preserves the original timestamp", () => {
  const q = enqueue([], ev({ occurredAt: "2026-07-20T14:00:10.000Z" }));
  assert.equal(q[0].occurredAt, "2026-07-20T14:00:10.000Z");
  assert.equal(q[0].attempts, 0);
});

test("dequeue removes exactly the acked event; markAttempt increments", () => {
  let q = enqueue(enqueue([], ev()), ev({ transition: "exit" }));
  const id = q[0].eventId;
  q = markAttempt(q, id);
  assert.equal(q.find((e) => e.eventId === id)?.attempts, 1);
  q = dequeue(q, id);
  assert.equal(q.length, 1);
  assert.equal(q.some((e) => e.eventId === id), false);
});

test("selectDueForRetry skips exhausted items and orders oldest-first", () => {
  let q = enqueue([], ev({ occurredAt: "2026-07-20T14:05:00.000Z" }));
  q = enqueue(q, ev({ transition: "exit", occurredAt: "2026-07-20T14:00:00.000Z" }));
  const due = selectDueForRetry(q);
  assert.equal(due[0].occurredAt, "2026-07-20T14:00:00.000Z"); // oldest first

  // Exhaust the first item.
  let exhausted = q;
  for (let i = 0; i < MAX_QUEUE_ATTEMPTS; i++) exhausted = markAttempt(exhausted, q[0].eventId);
  assert.equal(selectDueForRetry(exhausted).some((e) => e.eventId === q[0].eventId), false);
  assert.equal(pruneExhausted(exhausted).some((e) => e.eventId === q[0].eventId), false);
});
