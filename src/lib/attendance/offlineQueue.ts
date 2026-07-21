// Offline attendance event queue (pure core).
//
// Attendance transitions must survive being generated while offline, across app
// termination and device restart, and must never produce duplicate server
// records. This module is the pure core — a stable event id, failure
// classification, exponential backoff, ordering, quarantine, and diagnostics —
// with no storage or network. The durable store lives in offlineQueueStorage.ts
// and the flushing manager in offlineQueueClient.ts.
//
// Two invariants drive the design:
//
//   1. An event's ORIGINAL timestamp is never rewritten. A departure that
//      happened at 2:00 PM and syncs at 6:00 PM is still a 2:00 PM departure.
//   2. A retry is always idempotent. The stable event id, the server's
//      credential-scoped idempotency key, and the guarded writes in the
//      attendance runners all key off the same (job, zone, transition, minute)
//      dimension, so the same event can be delivered any number of times and
//      produce one record.

export type QueueEventState = "pending" | "quarantined";

export type QueuedAttendanceEvent = {
  // Stable, deterministic id — the dedupe + idempotency anchor.
  eventId: string;
  // The assignment this event belongs to. Ordering is preserved per job.
  jobId: string;
  // The schedule assignment, when the event was produced against one. Carried
  // through so a server-side reconciliation can attribute the event even if the
  // employee's current assignment has since changed.
  assignmentId: string | null;
  // Which device produced it — preserved so a queue flushed after a credential
  // rotation is still attributable to the right install.
  deviceId: string | null;
  zone: "arrival" | "wake";
  transition: "enter" | "exit";
  occurredAt: string; // ISO — preserved exactly, never "now" at flush time
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  source: "jobsite_auto" | "manual";
  attempts: number;
  queuedAt: string; // ISO
  // Earliest time this event may be retried (exponential backoff).
  nextAttemptAt: string; // ISO
  state: QueueEventState;
  // Why it last failed / why it was quarantined. Surfaced in diagnostics.
  lastError: string | null;
  lastAttemptAt: string | null;
};

/**
 * Deterministic id for a transition, truncated to the minute so a duplicate
 * delivery of the same enter/exit collapses to one queued event (and later to
 * one server record via the same idempotency dimension).
 */
export function makeEventId(parts: {
  jobId: string | number;
  zone: string;
  transition: string;
  occurredAt: string;
}): string {
  const minute = parts.occurredAt.slice(0, 16); // YYYY-MM-DDTHH:mm
  return [String(parts.jobId), parts.zone, parts.transition, minute].join("|");
}

export type NewQueueEvent = {
  eventId?: string;
  jobId: string | number;
  assignmentId?: string | null;
  deviceId?: string | null;
  zone: "arrival" | "wake";
  transition: "enter" | "exit";
  occurredAt: string;
  latitude?: number | null;
  longitude?: number | null;
  accuracyMeters?: number | null;
  source?: "jobsite_auto" | "manual";
};

// ── Retry policy ─────────────────────────────────────────────────────────────

// First retry delay. Short enough to recover quickly from a brief network blip.
export const BACKOFF_BASE_MS = 30_000;
// Ceiling on the per-attempt delay, so a long outage settles into a steady
// half-hourly probe rather than growing without bound.
export const BACKOFF_MAX_MS = 30 * 60_000;
// Attempts before an event is QUARANTINED rather than retried forever. With the
// backoff above this spans roughly six hours of continuous failure.
export const MAX_QUEUE_ATTEMPTS = 12;
// Quarantined events are kept this long for diagnosis, then pruned.
export const QUARANTINE_RETENTION_DAYS = 14;

/** Exponential backoff delay for the Nth attempt (0-based), capped. */
export function backoffDelayMs(attempts: number): number {
  if (attempts <= 0) return 0;
  const raw = BACKOFF_BASE_MS * 2 ** (attempts - 1);
  return Math.min(BACKOFF_MAX_MS, raw);
}

// How a submission failure is treated. The distinction matters: retrying a
// validation failure forever accomplishes nothing and hides the problem, while
// dropping a retryable failure silently loses attendance.
export type FailureClass =
  | "retryable" // network error, timeout, 5xx, 429 — try again later
  | "auth" // 401 — the credential expired or was rotated; refresh, then retry
  | "permanent"; // 4xx validation/authorization — will never succeed

/**
 * Classify a submission outcome. `status` is null for a transport-level failure
 * (offline, DNS, timeout), which is always retryable.
 */
export function classifyFailure(status: number | null): FailureClass {
  if (status === null) return "retryable";
  if (status === 401) return "auth";
  if (status === 408 || status === 429) return "retryable";
  if (status >= 500) return "retryable";
  if (status >= 400) return "permanent";
  return "retryable";
}

/**
 * Whether a response counts as delivered. A 2xx is obviously delivered, and so
 * is an `ignored` response — the server evaluated the event and deliberately
 * declined to act (not assigned, outside the window, duplicate). Re-sending it
 * would produce the same answer forever.
 */
export function isDelivered(status: number): boolean {
  return status >= 200 && status < 300;
}

// ── Queue operations (all pure; each returns a new array) ────────────────────

function nowIso(now?: string): string {
  return now ?? new Date().toISOString();
}

/** Add an event unless one with the same id is already queued (idempotent). */
export function enqueue(
  queue: QueuedAttendanceEvent[],
  event: NewQueueEvent,
  now?: string
): QueuedAttendanceEvent[] {
  const eventId =
    event.eventId ??
    makeEventId({
      jobId: event.jobId,
      zone: event.zone,
      transition: event.transition,
      occurredAt: event.occurredAt,
    });
  if (queue.some((q) => q.eventId === eventId)) return queue;
  const at = nowIso(now);
  return [
    ...queue,
    {
      eventId,
      jobId: String(event.jobId),
      assignmentId: event.assignmentId ?? null,
      deviceId: event.deviceId ?? null,
      zone: event.zone,
      transition: event.transition,
      occurredAt: event.occurredAt,
      latitude: event.latitude ?? null,
      longitude: event.longitude ?? null,
      accuracyMeters: event.accuracyMeters ?? null,
      source: event.source ?? "jobsite_auto",
      attempts: 0,
      queuedAt: at,
      nextAttemptAt: at,
      state: "pending",
      lastError: null,
      lastAttemptAt: null,
    },
  ];
}

export function dequeue(queue: QueuedAttendanceEvent[], eventId: string): QueuedAttendanceEvent[] {
  return queue.filter((q) => q.eventId !== eventId);
}

/**
 * Record a failed attempt: schedule the next retry with exponential backoff, or
 * quarantine the event when it is permanently rejected or has exhausted its
 * attempts. Quarantined events are KEPT (not deleted) so a real delivery
 * problem is visible rather than silently discarded.
 */
export function markFailure(
  queue: QueuedAttendanceEvent[],
  eventId: string,
  failure: FailureClass,
  reason: string,
  now?: string
): QueuedAttendanceEvent[] {
  const at = nowIso(now);
  const atMs = Date.parse(at);
  return queue.map((q) => {
    if (q.eventId !== eventId) return q;
    // An auth failure is not the event's fault — the credential needs
    // refreshing. It must not burn the retry budget, or a token that expires
    // overnight would quarantine a whole day of attendance.
    const attempts = failure === "auth" ? q.attempts : q.attempts + 1;
    const exhausted = failure !== "auth" && attempts >= MAX_QUEUE_ATTEMPTS;
    const quarantined = failure === "permanent" || exhausted;
    const delay = failure === "auth" ? BACKOFF_BASE_MS : backoffDelayMs(attempts);
    return {
      ...q,
      attempts,
      lastAttemptAt: at,
      lastError: reason,
      state: quarantined ? "quarantined" : "pending",
      nextAttemptAt: quarantined ? q.nextAttemptAt : new Date(atMs + delay).toISOString(),
    };
  });
}

/**
 * Events to submit on this pass, in the order they must be submitted.
 *
 * Ordering matters WITHIN a job: an exit must never reach the server before the
 * enter that opened the shift, or the exit would find no open timecard. So only
 * the OLDEST due event per job is returned each pass — the next one goes on the
 * following pass, after its predecessor has been delivered and removed.
 * Different jobs are independent and do not block each other.
 *
 * Quarantined events are excluded from ordering entirely: they will never be
 * delivered, so blocking a job's queue behind one would stall it forever.
 */
export function selectDueForRetry(
  queue: QueuedAttendanceEvent[],
  now?: string
): QueuedAttendanceEvent[] {
  const atMs = Date.parse(nowIso(now));
  const byJob = new Map<string, QueuedAttendanceEvent[]>();
  for (const event of queue) {
    if (event.state !== "pending") continue;
    const list = byJob.get(event.jobId) ?? [];
    list.push(event);
    byJob.set(event.jobId, list);
  }

  const heads: QueuedAttendanceEvent[] = [];
  for (const list of byJob.values()) {
    const ordered = list.slice().sort((a, b) => {
      const byOccurred = Date.parse(a.occurredAt) - Date.parse(b.occurredAt);
      if (byOccurred !== 0) return byOccurred;
      // Same minute (e.g. an enter and exit that collapsed to one timestamp) —
      // fall back to the order they were queued in.
      return Date.parse(a.queuedAt) - Date.parse(b.queuedAt);
    });
    const head = ordered[0];
    if (head && Date.parse(head.nextAttemptAt) <= atMs) heads.push(head);
  }

  return heads.sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
}

/** Drop quarantined events past the retention window. Pending events are kept. */
export function pruneQuarantined(
  queue: QueuedAttendanceEvent[],
  now?: string,
  retentionDays = QUARANTINE_RETENTION_DAYS
): QueuedAttendanceEvent[] {
  const cutoff = Date.parse(nowIso(now)) - retentionDays * 24 * 60 * 60 * 1000;
  return queue.filter((q) => {
    if (q.state !== "quarantined") return true;
    const at = Date.parse(q.lastAttemptAt ?? q.queuedAt);
    return !Number.isFinite(at) || at >= cutoff;
  });
}

// ── Diagnostics ──────────────────────────────────────────────────────────────

export type QueueDiagnostics = {
  pendingCount: number;
  quarantinedCount: number;
  // The oldest event still waiting, by the time it actually occurred.
  oldestQueuedAt: string | null;
  oldestOccurredAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
  // When the next retry is due, so the UI can say "retrying in…" truthfully.
  nextAttemptAt: string | null;
};

export function queueDiagnostics(
  queue: QueuedAttendanceEvent[],
  meta: { lastSuccessfulSyncAt?: string | null; lastFailureAt?: string | null; lastFailureReason?: string | null } = {}
): QueueDiagnostics {
  const pending = queue.filter((q) => q.state === "pending");
  const oldestBy = (key: "queuedAt" | "occurredAt"): string | null => {
    let best: string | null = null;
    for (const event of pending) {
      const value = event[key];
      if (!best || Date.parse(value) < Date.parse(best)) best = value;
    }
    return best;
  };
  let nextAttemptAt: string | null = null;
  for (const event of pending) {
    if (!nextAttemptAt || Date.parse(event.nextAttemptAt) < Date.parse(nextAttemptAt)) {
      nextAttemptAt = event.nextAttemptAt;
    }
  }
  return {
    pendingCount: pending.length,
    quarantinedCount: queue.length - pending.length,
    oldestQueuedAt: oldestBy("queuedAt"),
    oldestOccurredAt: oldestBy("occurredAt"),
    lastSuccessfulSyncAt: meta.lastSuccessfulSyncAt ?? null,
    lastFailureAt: meta.lastFailureAt ?? null,
    lastFailureReason: meta.lastFailureReason ?? null,
    nextAttemptAt,
  };
}

// ── Persistence shape migration ──────────────────────────────────────────────

export const QUEUE_SCHEMA_VERSION = 2;

/**
 * Normalize anything read back from storage into the current shape.
 *
 * This is the crash/restart-recovery path: a queue written by an older build,
 * a partially-written record, or a value corrupted by a kill mid-write must
 * yield a usable queue rather than throwing away attendance. Unreadable
 * ENTRIES are dropped individually; an unreadable QUEUE yields an empty one.
 */
export function normalizeStoredQueue(raw: unknown, now?: string): QueuedAttendanceEvent[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { events?: unknown })?.events)
      ? ((raw as { events: unknown[] }).events)
      : [];
  const at = nowIso(now);
  const out: QueuedAttendanceEvent[] = [];
  const seen = new Set<string>();

  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const jobId = e.jobId === undefined || e.jobId === null ? null : String(e.jobId);
    const occurredAt = typeof e.occurredAt === "string" ? e.occurredAt : null;
    const zone = e.zone === "wake" ? "wake" : "arrival";
    const transition = e.transition === "exit" ? "exit" : e.transition === "enter" ? "enter" : null;
    // Without a job, a timestamp, or a direction the event is unusable — it
    // cannot be submitted and cannot be reconstructed.
    if (!jobId || !occurredAt || !transition || !Number.isFinite(Date.parse(occurredAt))) continue;

    const eventId =
      typeof e.eventId === "string" && e.eventId
        ? e.eventId
        : makeEventId({ jobId, zone, transition, occurredAt });
    if (seen.has(eventId)) continue;
    seen.add(eventId);

    const num = (value: unknown): number | null => {
      const n = Number(value);
      return value === null || value === undefined || !Number.isFinite(n) ? null : n;
    };
    const attempts = Number.isFinite(Number(e.attempts)) ? Math.max(0, Number(e.attempts)) : 0;
    const state: QueueEventState = e.state === "quarantined" ? "quarantined" : "pending";

    out.push({
      eventId,
      jobId,
      assignmentId: typeof e.assignmentId === "string" ? e.assignmentId : null,
      deviceId: typeof e.deviceId === "string" ? e.deviceId : null,
      zone,
      transition,
      occurredAt,
      latitude: num(e.latitude),
      longitude: num(e.longitude),
      accuracyMeters: num(e.accuracyMeters),
      source: e.source === "manual" ? "manual" : "jobsite_auto",
      attempts,
      queuedAt: typeof e.queuedAt === "string" ? e.queuedAt : occurredAt,
      // A v1 record has no schedule. Making it due immediately is correct: the
      // app just started, and the event has been waiting.
      nextAttemptAt: typeof e.nextAttemptAt === "string" ? e.nextAttemptAt : at,
      state,
      lastError: typeof e.lastError === "string" ? e.lastError : null,
      lastAttemptAt: typeof e.lastAttemptAt === "string" ? e.lastAttemptAt : null,
    });
  }

  return out;
}
