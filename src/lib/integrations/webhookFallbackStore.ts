type FallbackWebhookEvent = {
  id: string;
  provider: string;
  company_id: string | null;
  idempotency_key: string | null;
  status: string;
  error: string | null;
  received_at: string;
  processed_at: string | null;
};

const storeKey = "__groundworkWebhookFallbackStore";

function getStore(): FallbackWebhookEvent[] {
  const root = globalThis as typeof globalThis & {
    [storeKey]?: FallbackWebhookEvent[];
  };
  if (!root[storeKey]) {
    root[storeKey] = [];
  }
  return root[storeKey]!;
}

export function findFallbackWebhookEvent(provider: string, idempotencyKey: string) {
  return (
    getStore().find(
      (item) => item.provider === provider && item.idempotency_key === idempotencyKey
    ) ?? null
  );
}

export function createFallbackWebhookEvent(input: {
  provider: string;
  idempotencyKey: string | null;
  status: string;
  error: string | null;
}) {
  const now = new Date().toISOString();
  const event: FallbackWebhookEvent = {
    id: randomUUID(),
    provider: input.provider,
    company_id: null,
    idempotency_key: input.idempotencyKey,
    status: input.status,
    error: input.error,
    received_at: now,
    processed_at: now,
  };
  getStore().push(event);
  return event;
}

export function isMissingWebhookEventsSchema(error: unknown) {
  const code =
    typeof error === "object" &&
    error &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
      ? String((error as { code?: string }).code)
      : "";
  if (code === "42P01") return true;

  const message =
    typeof error === "object" &&
    error &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
      ? String((error as { message?: string }).message)
      : "";

  const normalized = message.toLowerCase();
  return (
    normalized.includes("relation") &&
    normalized.includes("webhook_events") &&
    normalized.includes("does not exist")
  );
}
import { randomUUID } from "node:crypto";
