import { parseProviderKey, getProviderAdapter } from "@/lib/integrations/providerAdapters";
import {
  enqueueFallbackOutboxEvent,
  failFallbackOutboxEvent,
  completeFallbackOutboxEvent,
  retryFallbackOutboxEvent,
  claimFallbackOutboxEvents,
  findFallbackOutboxByIdempotency,
  isMissingOutboxSchema,
} from "@/lib/outbox/fallbackStore";

type SupabaseClient = {
  from: (table: string) => unknown;
};

type SupabaseQueryError = {
  message?: string;
};

type SupabaseQueryResult = {
  data: unknown;
  error: SupabaseQueryError | null;
};

type SupabaseQueryBuilder = {
  then: PromiseLike<SupabaseQueryResult>["then"];
  select: (...args: unknown[]) => SupabaseQueryBuilder;
  eq: (...args: unknown[]) => SupabaseQueryBuilder;
  order: (...args: unknown[]) => SupabaseQueryBuilder;
  limit: (...args: unknown[]) => SupabaseQueryBuilder;
  lte: (...args: unknown[]) => SupabaseQueryBuilder;
  insert: (payload: unknown) => SupabaseQueryBuilder;
  update: (payload: unknown) => SupabaseQueryBuilder;
  maybeSingle: () => Promise<SupabaseQueryResult>;
  single: () => Promise<SupabaseQueryResult>;
};

type EnqueueOutboxInput = {
  companyId: string;
  eventType: string;
  aggregateType?: string | null;
  aggregateId?: string | null;
  payload?: Record<string, unknown>;
  idempotencyKey?: string | null;
  maxAttempts?: number;
};

type OutboxRow = {
  id: string;
  company_id: string;
  event_type: string;
  aggregate_type: string | null;
  aggregate_id: string | null;
  payload: Record<string, unknown> | null;
  idempotency_key: string | null;
  status: "queued" | "processing" | "processed" | "failed";
  attempts: number;
  max_attempts: number;
  run_at: string;
  processed_at: string | null;
  last_error: string | null;
  created_at: string;
};

export function getOutboxRetryRunAt(attempts: number) {
  const seconds = Math.min(60 * Math.max(1, attempts), 60 * 30);
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export async function enqueueOutboxEvent(
  supabase: SupabaseClient,
  input: EnqueueOutboxInput
) {
  const outboxTable = supabase.from("outbox_events") as SupabaseQueryBuilder;

  if (input.idempotencyKey) {
    const { data: existingByKey, error: existingError } = await outboxTable
      .select("id, company_id, event_type, aggregate_type, aggregate_id, payload, idempotency_key, status, attempts, max_attempts, run_at, processed_at, last_error, created_at")
      .eq("company_id", input.companyId)
      .eq("idempotency_key", input.idempotencyKey)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingByKey) {
      return existingByKey as OutboxRow;
    }

    if (existingError && !isMissingOutboxSchema(existingError.message || "")) {
      throw new Error(existingError.message || "Failed to check outbox idempotency");
    }

    if (existingError && isMissingOutboxSchema(existingError.message || "")) {
      const fallbackExisting = findFallbackOutboxByIdempotency(
        input.companyId,
        input.idempotencyKey
      );
      if (fallbackExisting) return fallbackExisting;
    }
  }

  const payload = {
    company_id: input.companyId,
    event_type: input.eventType,
    aggregate_type: input.aggregateType ?? null,
    aggregate_id: input.aggregateId ?? null,
    payload: input.payload ?? {},
    idempotency_key: input.idempotencyKey ?? null,
    status: "queued",
    attempts: 0,
    max_attempts: input.maxAttempts ?? 5,
    run_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await outboxTable
    .insert(payload)
    .select("id, company_id, event_type, aggregate_type, aggregate_id, payload, idempotency_key, status, attempts, max_attempts, run_at, processed_at, last_error, created_at")
    .single();

  if (error && isMissingOutboxSchema(error.message || "")) {
    return enqueueFallbackOutboxEvent({
      companyId: input.companyId,
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
      maxAttempts: input.maxAttempts,
    });
  }

  if (error || !data) {
    throw new Error(error?.message || "Failed to enqueue outbox event");
  }

  return data as OutboxRow;
}

async function dispatchOutboxEvent(event: OutboxRow) {
  const providerRaw = event.payload?.provider;
  const provider =
    typeof providerRaw === "string" ? parseProviderKey(providerRaw) : null;

  if (!provider) {
    return { status: "noop" as const };
  }

  const adapter = getProviderAdapter(provider);
  const result = await adapter.sync();
  if (result.status === "error") {
    throw new Error(result.message || "Provider sync failed");
  }

  return { status: "synced" as const, message: result.message };
}

export async function processOutboxEvents(
  supabase: SupabaseClient,
  companyId: string,
  limit: number
) {
  const outboxTable = supabase.from("outbox_events") as SupabaseQueryBuilder;
  const nowIso = new Date().toISOString();
  const { data: candidates, error: candidatesError } = await outboxTable
    .select("id, company_id, event_type, aggregate_type, aggregate_id, payload, idempotency_key, status, attempts, max_attempts, run_at, processed_at, last_error, created_at")
    .eq("company_id", companyId)
    .eq("status", "queued")
    .lte("run_at", nowIso)
    .order("created_at", { ascending: true })
    .limit(limit);

  let rows: OutboxRow[] = [];
  let useFallback = false;

  if (candidatesError && isMissingOutboxSchema(candidatesError.message || "")) {
    useFallback = true;
    rows = claimFallbackOutboxEvents(companyId, limit) as OutboxRow[];
  } else if (candidatesError) {
    throw new Error(candidatesError.message || "Failed to load outbox events");
  } else {
    rows = (candidates ?? []) as OutboxRow[];
  }

  let processed = 0;
  let completed = 0;
  let retried = 0;
  let failed = 0;

  for (const row of rows) {
    let claimed: OutboxRow | null = row;

    if (!useFallback) {
      const { data: claimData } = await outboxTable
        .update({
          status: "processing",
          attempts: row.attempts + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("company_id", companyId)
        .eq("status", "queued")
        .select("id, company_id, event_type, aggregate_type, aggregate_id, payload, idempotency_key, status, attempts, max_attempts, run_at, processed_at, last_error, created_at")
        .maybeSingle();
      claimed = (claimData as OutboxRow | null) ?? null;
      if (!claimed) continue;
    }

    processed += 1;
    try {
      await dispatchOutboxEvent(claimed);
      if (useFallback) {
        completeFallbackOutboxEvent(companyId, claimed.id);
      } else {
        await outboxTable
          .update({
            status: "processed",
            processed_at: new Date().toISOString(),
            last_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", claimed.id)
          .eq("company_id", companyId);
      }
      completed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Outbox dispatch failed";
      if (claimed.attempts >= claimed.max_attempts) {
        if (useFallback) {
          failFallbackOutboxEvent(companyId, claimed.id, message);
        } else {
          await outboxTable
            .update({
              status: "failed",
              last_error: message,
              updated_at: new Date().toISOString(),
            })
            .eq("id", claimed.id)
            .eq("company_id", companyId);
        }
        failed += 1;
      } else {
        const retryAt = getOutboxRetryRunAt(claimed.attempts);
        if (useFallback) {
          retryFallbackOutboxEvent(companyId, claimed.id, retryAt, message);
        } else {
          await outboxTable
            .update({
              status: "queued",
              run_at: retryAt,
              last_error: message,
              updated_at: new Date().toISOString(),
            })
            .eq("id", claimed.id)
            .eq("company_id", companyId);
        }
        retried += 1;
      }
    }
  }

  return {
    claimed: rows.length,
    processed,
    completed,
    retried,
    failed,
  };
}
