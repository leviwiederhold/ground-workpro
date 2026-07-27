/* eslint-disable @typescript-eslint/no-explicit-any */
// End-to-end offline synchronization: durable storage + the flushing manager.
//
// These exercise the REAL storage adapter and the real flush loop against a
// fake localStorage and a fake fetch, so the acceptance criteria (original
// timestamps survive, a restart loses nothing, retries never duplicate,
// permanently invalid events are quarantined) are tested through the same code
// path the app runs.

import test from "node:test";
import assert from "node:assert/strict";

const T_ARRIVAL = "2026-07-21T10:50:00.000Z";
const T_DEPARTURE = "2026-07-21T18:00:00.000Z";

// ── Fake environment ─────────────────────────────────────────────────────────

type Call = { jobId: string; transition: string; occurredAt: string };

class FakeStorage {
  private data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  /** Simulate app termination + relaunch: the process is new, the disk is not. */
  snapshot(): Map<string, string> {
    return new Map(this.data);
  }
  restore(snapshot: Map<string, string>) {
    this.data = new Map(snapshot);
  }
}

const storage = new FakeStorage();
const navigatorState = { onLine: true };
let responses: Array<number | "network-error"> = [];
let calls: Call[] = [];

function installEnvironment() {
  const g = globalThis as any;
  g.window = {
    localStorage: storage,
    addEventListener() {},
    removeEventListener() {},
    setInterval: () => 0,
    clearInterval() {},
  };
  // Node defines navigator as a getter-only global, so it must be redefined.
  Object.defineProperty(g, "navigator", { value: navigatorState, configurable: true, writable: true });
  g.document = { addEventListener() {}, removeEventListener() {}, visibilityState: "visible" };
  if (!g.crypto?.randomUUID) {
    Object.defineProperty(g, "crypto", {
      value: { randomUUID: () => "device-uuid" },
      configurable: true,
      writable: true,
    });
  }
  g.fetch = async (_url: string, init?: any) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ jobId: body.jobId, transition: body.transition, occurredAt: body.occurredAt });
    const next = responses.shift() ?? 200;
    if (next === "network-error") throw new Error("offline");
    return { status: next, ok: next >= 200 && next < 300 };
  };
}

installEnvironment();

// Imported AFTER the environment exists — the modules read `window` at call
// time, but importing first keeps the intent obvious.
const { enqueueAttendanceEvent, flushAttendanceQueue, getAttendanceQueueDiagnostics } = await import(
  "../../src/lib/attendance/offlineQueueClient.ts"
);
const { loadQueue } = await import("../../src/lib/attendance/offlineQueueStorage.ts");

function reset() {
  storage.restore(new Map());
  responses = [];
  calls = [];
}

const arrival = {
  jobId: "job-1",
  zone: "arrival" as const,
  transition: "enter" as const,
  occurredAt: T_ARRIVAL,
  latitude: 40,
  longitude: -75,
  accuracyMeters: 12,
};

const departure = { ...arrival, transition: "exit" as const, occurredAt: T_DEPARTURE };

// ── Acceptance criteria ──────────────────────────────────────────────────────

test("events created offline synchronize later with their ORIGINAL timestamps", async () => {
  reset();
  navigatorState.onLine = false;

  await enqueueAttendanceEvent(arrival);
  await enqueueAttendanceEvent(departure);
  await flushAttendanceQueue();
  assert.equal(calls.length, 0, "nothing is sent while offline");

  // Connectivity returns hours later.
  navigatorState.onLine = true;
  responses = [200, 200];
  await flushAttendanceQueue();

  assert.equal(calls.length, 2);
  assert.equal(calls[0].occurredAt, T_ARRIVAL); // 6:50 AM, not "now"
  assert.equal(calls[1].occurredAt, T_DEPARTURE); // 2:00 PM, not "now"
  assert.equal(getAttendanceQueueDiagnostics().pendingCount, 0);
});

test("the arrival is submitted before the departure, whatever order they queued in", async () => {
  reset();
  await enqueueAttendanceEvent(departure);
  await enqueueAttendanceEvent(arrival);
  responses = [200, 200];

  await flushAttendanceQueue();

  assert.deepEqual(
    calls.map((c) => c.transition),
    ["enter", "exit"]
  );
});

test("app restart does not lose queued events", async () => {
  reset();
  navigatorState.onLine = false;
  await enqueueAttendanceEvent(arrival);
  await enqueueAttendanceEvent(departure);

  // Terminate: keep the disk, throw away everything in memory.
  const disk = storage.snapshot();
  storage.restore(new Map());
  assert.equal((await loadQueue()).queue.length, 0);
  storage.restore(disk);

  const recovered = await loadQueue();
  assert.equal(recovered.queue.length, 2);
  assert.equal(recovered.queue[0].occurredAt, T_ARRIVAL);

  navigatorState.onLine = true;
  responses = [200, 200];
  await flushAttendanceQueue();
  assert.equal(calls.length, 2);
});

test("duplicate retries do not create duplicate attendance records", async () => {
  reset();
  await enqueueAttendanceEvent(arrival);
  // The same transition delivered twice by the native layer.
  await enqueueAttendanceEvent({ ...arrival, occurredAt: "2026-07-21T10:50:35.000Z" });
  responses = [200];

  await flushAttendanceQueue();

  // One queued event, one submission — the stable event id collapsed them
  // before the network was ever touched.
  assert.equal(calls.length, 1);
  assert.equal(getAttendanceQueueDiagnostics().pendingCount, 0);
});

test("a permanently invalid event is quarantined instead of retrying forever", async () => {
  reset();
  await enqueueAttendanceEvent(arrival);
  responses = [422];

  await flushAttendanceQueue();
  assert.equal(calls.length, 1);

  // Every later flush leaves it alone.
  responses = [200, 200, 200];
  await flushAttendanceQueue();
  await flushAttendanceQueue();
  assert.equal(calls.length, 1, "the rejected event is never re-sent");

  const diagnostics = getAttendanceQueueDiagnostics();
  assert.equal(diagnostics.pendingCount, 0);
  assert.equal(diagnostics.quarantinedCount, 1); // kept, not silently dropped
  assert.equal(diagnostics.lastFailureReason, "HTTP 422");
});

test("a network failure keeps the event queued and backs off", async () => {
  reset();
  await enqueueAttendanceEvent(arrival);
  responses = ["network-error"];

  await flushAttendanceQueue();

  const diagnostics = getAttendanceQueueDiagnostics();
  assert.equal(diagnostics.pendingCount, 1);
  assert.equal(diagnostics.quarantinedCount, 0);
  // Backed off — an immediate re-flush does not hammer the server.
  const before = calls.length;
  await flushAttendanceQueue();
  assert.equal(calls.length, before);
});

test("a server fault is retried, and the retry succeeds", async () => {
  reset();
  await enqueueAttendanceEvent(arrival);
  responses = [503];
  await flushAttendanceQueue();
  assert.equal(getAttendanceQueueDiagnostics().pendingCount, 1);

  // Fast-forward past the backoff by rewriting the stored schedule, which is
  // exactly what the passage of time would do.
  const raw = JSON.parse(storage.getItem("attendance.offlineQueue.v1") as string);
  raw.events[0].nextAttemptAt = "2026-07-21T10:50:00.000Z";
  storage.setItem("attendance.offlineQueue.v1", JSON.stringify(raw));

  responses = [200];
  await flushAttendanceQueue();

  assert.equal(calls.length, 2);
  assert.equal(calls[1].occurredAt, T_ARRIVAL); // still the original time
  assert.equal(getAttendanceQueueDiagnostics().pendingCount, 0);
});

test("an expired credential does not consume the retry budget", async () => {
  reset();
  await enqueueAttendanceEvent(arrival);
  responses = [401];

  await flushAttendanceQueue();

  const stored = (await loadQueue()).queue;
  assert.equal(stored.length, 1);
  assert.equal(stored[0].state, "pending");
  assert.equal(stored[0].attempts, 0);
});

test("diagnostics report the oldest waiting event and the last successful sync", async () => {
  reset();
  await enqueueAttendanceEvent(arrival);
  responses = [200];
  await flushAttendanceQueue();
  const afterSuccess = getAttendanceQueueDiagnostics();
  assert.equal(afterSuccess.pendingCount, 0);
  assert.ok(afterSuccess.lastSuccessfulSyncAt);

  navigatorState.onLine = false;
  await enqueueAttendanceEvent(departure);
  const withBacklog = getAttendanceQueueDiagnostics();
  assert.equal(withBacklog.pendingCount, 1);
  assert.equal(withBacklog.oldestOccurredAt, T_DEPARTURE);
  assert.equal(withBacklog.lastSuccessfulSyncAt, afterSuccess.lastSuccessfulSyncAt);
  navigatorState.onLine = true;
});

test("a queue corrupted by a kill mid-write does not break attendance", async () => {
  reset();
  storage.setItem("attendance.offlineQueue.v1", '{"version":2,"events":[{"jobId":"job-1","occ');

  const recovered = await loadQueue();
  assert.deepEqual(recovered.queue, []);

  // And the queue keeps working from there.
  await enqueueAttendanceEvent(arrival);
  responses = [200];
  await flushAttendanceQueue();
  assert.equal(calls.length, 1);
});

test("events for different jobs are all delivered in one flush", async () => {
  reset();
  await enqueueAttendanceEvent(arrival);
  await enqueueAttendanceEvent({ ...arrival, jobId: "job-2" });
  responses = [200, 200];

  await flushAttendanceQueue();

  assert.equal(calls.length, 2);
  assert.deepEqual(new Set(calls.map((c) => c.jobId)), new Set(["job-1", "job-2"]));
});
