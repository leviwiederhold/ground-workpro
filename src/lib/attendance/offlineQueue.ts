// Offline attendance event queue (pure).
//
// Attendance transitions must survive being generated while offline, across app
// restarts, and must never produce duplicate server records. This module is the
// pure core: a stable event id (so retries and duplicate native deliveries
// collapse), plus enqueue/dequeue/retry-selection over an in-memory list. The
// storage-backed manager (offlineQueueClient.ts) wraps this with persistence and
// network flushing.

export type QueuedAttendanceEvent = {
  // Stable, deterministic id — the dedupe + idempotency anchor.
  eventId: string;
  jobId: string;
  zone: "arrival" | "wake";
  transition: "enter" | "exit";
  occurredAt: string; // ISO — preserved exactly (never "now" at flush time)
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  attempts: number;
  queuedAt: string; // ISO
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
  zone: "arrival" | "wake";
  transition: "enter" | "exit";
  occurredAt: string;
  latitude?: number | null;
  longitude?: number | null;
  accuracyMeters?: number | null;
};

/** Add an event unless one with the same id is already queued (idempotent). */
export function enqueue(queue: QueuedAttendanceEvent[], event: NewQueueEvent): QueuedAttendanceEvent[] {
  const eventId =
    event.eventId ??
    makeEventId({ jobId: event.jobId, zone: event.zone, transition: event.transition, occurredAt: event.occurredAt });
  if (queue.some((q) => q.eventId === eventId)) return queue;
  return [
    ...queue,
    {
      eventId,
      jobId: String(event.jobId),
      zone: event.zone,
      transition: event.transition,
      occurredAt: event.occurredAt,
      latitude: event.latitude ?? null,
      longitude: event.longitude ?? null,
      accuracyMeters: event.accuracyMeters ?? null,
      attempts: 0,
      queuedAt: new Date().toISOString(),
    },
  ];
}

export function dequeue(queue: QueuedAttendanceEvent[], eventId: string): QueuedAttendanceEvent[] {
  return queue.filter((q) => q.eventId !== eventId);
}

export function markAttempt(queue: QueuedAttendanceEvent[], eventId: string): QueuedAttendanceEvent[] {
  return queue.map((q) => (q.eventId === eventId ? { ...q, attempts: q.attempts + 1 } : q));
}

// Give up on an event after this many failed attempts to avoid a poison item
// blocking the queue forever.
export const MAX_QUEUE_ATTEMPTS = 25;

/** Events still worth retrying (haven't exhausted their attempts), oldest first. */
export function selectDueForRetry(queue: QueuedAttendanceEvent[]): QueuedAttendanceEvent[] {
  return queue
    .filter((q) => q.attempts < MAX_QUEUE_ATTEMPTS)
    .slice()
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
}

/** Drop events that have exhausted their retries (kept separate for auditing). */
export function pruneExhausted(queue: QueuedAttendanceEvent[]): QueuedAttendanceEvent[] {
  return queue.filter((q) => q.attempts < MAX_QUEUE_ATTEMPTS);
}
