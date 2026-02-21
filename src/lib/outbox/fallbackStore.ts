type OutboxStatus = "queued" | "processing" | "processed" | "failed";

type OutboxEventRecord = {
  id: string;
  company_id: string;
  event_type: string;
  aggregate_type: string | null;
  aggregate_id: string | null;
  payload: Record<string, unknown>;
  idempotency_key: string | null;
  status: OutboxStatus;
  attempts: number;
  max_attempts: number;
  run_at: string;
  processed_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type OutboxFallbackState = Map<string, OutboxEventRecord[]>;

const fallbackState = (() => {
  const globalRef = globalThis as typeof globalThis & {
    __GROUNDWORK_OUTBOX_FALLBACK__?: OutboxFallbackState;
  };
  if (!globalRef.__GROUNDWORK_OUTBOX_FALLBACK__) {
    globalRef.__GROUNDWORK_OUTBOX_FALLBACK__ = new Map<string, OutboxEventRecord[]>();
  }
  return globalRef.__GROUNDWORK_OUTBOX_FALLBACK__;
})();

function getEvents(companyId: string) {
  const existing = fallbackState.get(companyId);
  if (existing) return existing;
  const created: OutboxEventRecord[] = [];
  fallbackState.set(companyId, created);
  return created;
}

export function isMissingOutboxSchema(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("outbox_events") &&
    (normalized.includes("does not exist") ||
      normalized.includes("schema cache") ||
      normalized.includes("could not find"))
  );
}

export function findFallbackOutboxByIdempotency(companyId: string, key: string) {
  return (
    getEvents(companyId).find(
      (event) => event.idempotency_key === key
    ) ?? null
  );
}

export function enqueueFallbackOutboxEvent(input: {
  companyId: string;
  eventType: string;
  aggregateType?: string | null;
  aggregateId?: string | null;
  payload?: Record<string, unknown>;
  idempotencyKey?: string | null;
  maxAttempts?: number;
}) {
  const now = new Date().toISOString();
  const created: OutboxEventRecord = {
    id: randomUUID(),
    company_id: input.companyId,
    event_type: input.eventType,
    aggregate_type: input.aggregateType ?? null,
    aggregate_id: input.aggregateId ?? null,
    payload: input.payload ?? {},
    idempotency_key: input.idempotencyKey ?? null,
    status: "queued",
    attempts: 0,
    max_attempts: input.maxAttempts ?? 5,
    run_at: now,
    processed_at: null,
    last_error: null,
    created_at: now,
    updated_at: now,
  };
  getEvents(input.companyId).push(created);
  return created;
}

export function claimFallbackOutboxEvents(companyId: string, limit: number) {
  const nowMs = Date.now();
  const events = getEvents(companyId)
    .filter(
      (event) =>
        event.status === "queued" && new Date(event.run_at).getTime() <= nowMs
    )
    .sort((a, b) => (a.created_at > b.created_at ? 1 : -1))
    .slice(0, limit);

  for (const event of events) {
    event.status = "processing";
    event.attempts += 1;
    event.updated_at = new Date().toISOString();
  }
  return events;
}

export function completeFallbackOutboxEvent(companyId: string, id: string) {
  const event = getEvents(companyId).find((item) => item.id === id);
  if (!event) return;
  const now = new Date().toISOString();
  event.status = "processed";
  event.processed_at = now;
  event.last_error = null;
  event.updated_at = now;
}

export function retryFallbackOutboxEvent(
  companyId: string,
  id: string,
  runAt: string,
  lastError: string
) {
  const event = getEvents(companyId).find((item) => item.id === id);
  if (!event) return;
  event.status = "queued";
  event.run_at = runAt;
  event.last_error = lastError;
  event.updated_at = new Date().toISOString();
}

export function failFallbackOutboxEvent(companyId: string, id: string, lastError: string) {
  const event = getEvents(companyId).find((item) => item.id === id);
  if (!event) return;
  event.status = "failed";
  event.last_error = lastError;
  event.updated_at = new Date().toISOString();
}
import { randomUUID } from "node:crypto";
