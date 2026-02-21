import { createHmac, timingSafeEqual } from "node:crypto";
import { parseProviderKey } from "@/lib/integrations/providerAdapters";

export type WebhookSignatureVerification = {
  ok: boolean;
  mode: "verified" | "skipped" | "failed";
  error?: string;
};

function getHeaderValue(headers: Headers, key: string): string | null {
  const value = headers.get(key);
  if (!value) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function verifyQuickBooksSignature(rawBody: string, headers: Headers): WebhookSignatureVerification {
  const secret = process.env.QUICKBOOKS_WEBHOOK_SECRET;
  if (!secret) {
    return { ok: true, mode: "skipped" };
  }

  const signature =
    getHeaderValue(headers, "intuit-signature") ??
    getHeaderValue(headers, "x-qbo-signature");
  if (!signature) {
    return { ok: false, mode: "failed", error: "Missing webhook signature" };
  }

  const expectedSignature = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const signatureBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  if (signatureBuffer.length !== expectedBuffer.length) {
    return { ok: false, mode: "failed", error: "Invalid webhook signature" };
  }

  const verified = timingSafeEqual(signatureBuffer, expectedBuffer);
  if (!verified) {
    return { ok: false, mode: "failed", error: "Invalid webhook signature" };
  }

  return { ok: true, mode: "verified" };
}

export function verifyWebhookSignature(provider: string, rawBody: string, headers: Headers): WebhookSignatureVerification {
  const providerKey = parseProviderKey(provider);
  if (!providerKey) {
    return { ok: false, mode: "failed", error: "Unsupported provider" };
  }

  if (providerKey === "quickbooks") {
    return verifyQuickBooksSignature(rawBody, headers);
  }

  return { ok: true, mode: "skipped" };
}

export function getWebhookIdempotencyKey(provider: string, rawBody: string, headers: Headers): string | null {
  const explicitKey =
    getHeaderValue(headers, "x-idempotency-key") ??
    getHeaderValue(headers, "idempotency-key") ??
    getHeaderValue(headers, "x-event-id");
  if (explicitKey) return explicitKey;

  const providerKey = parseProviderKey(provider);
  if (providerKey === "quickbooks") {
    const intuitId = getHeaderValue(headers, "intuit-event-id");
    if (intuitId) return intuitId;
  }

  try {
    const json = JSON.parse(rawBody) as { eventId?: unknown; id?: unknown };
    if (typeof json.eventId === "string" && json.eventId.trim().length > 0) {
      return json.eventId.trim();
    }
    if (typeof json.id === "string" && json.id.trim().length > 0) {
      return json.id.trim();
    }
  } catch {
    // ignore parse errors for non-json payloads
  }

  return null;
}
