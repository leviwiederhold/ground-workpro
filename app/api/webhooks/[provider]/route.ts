import { createHash } from "node:crypto";
import { z } from "next/dist/compiled/zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { okItem } from "@/lib/http/json";
import { serverError, validationError } from "@/lib/http/errors";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { incrementMetric } from "@/lib/observability/metrics";
import {
  getWebhookIdempotencyKey,
  verifyWebhookSignature,
} from "@/lib/integrations/webhooks";
import {
  createFallbackWebhookEvent,
  findFallbackWebhookEvent,
} from "@/lib/integrations/webhookFallbackStore";
import { parseProviderKey } from "@/lib/integrations/providerAdapters";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  provider: z.string().trim().min(1).max(64).regex(/^[a-z0-9-]+$/),
});

type ValidationIssue = {
  path: Array<string | number>;
  message: string;
};

function toValidationDetails(error: { issues: ValidationIssue[] }) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

function toNormalizedHeaders(headers: Headers) {
  const pairs = Array.from(headers.entries()).sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(pairs);
}

function hashText(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

type WebhookEventRow = {
  id: string;
  provider: string;
  company_id: string | null;
  idempotency_key: string | null;
  status: string;
  error: string | null;
  received_at: string;
  processed_at: string | null;
};

function toResponseItem(event: WebhookEventRow, duplicate: boolean, signature: string) {
  return {
    ...event,
    duplicate,
    signature,
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const rateLimited = enforceRateLimit(request, {
    keyPrefix: "webhook-ingest",
    limit: 120,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  try {
    const rawParams = await params;
    const parsedParams = paramsSchema.safeParse(rawParams);
    if (!parsedParams.success) {
      return validationError(toValidationDetails(parsedParams.error));
    }

    const provider = parsedParams.data.provider;
    const providerKey = parseProviderKey(provider);
    if (!providerKey) {
      return validationError([{ path: "provider", message: "Unsupported provider" }]);
    }

    const rawBody = await request.text();
    const normalizedHeaders = toNormalizedHeaders(request.headers);
    const headersHash = hashText(JSON.stringify(normalizedHeaders));
    const bodyHash = hashText(rawBody);
    const idempotencyKey = getWebhookIdempotencyKey(providerKey, rawBody, request.headers);
    const verification = verifyWebhookSignature(providerKey, rawBody, request.headers);

    const supabaseAdmin = getSupabaseAdmin();

    if (idempotencyKey && !supabaseAdmin) {
      const fallbackExisting = findFallbackWebhookEvent(providerKey, idempotencyKey);
      if (fallbackExisting) {
        return okItem(toResponseItem(fallbackExisting, true, verification.mode));
      }
    } else if (idempotencyKey && supabaseAdmin) {
      const { data: existing, error: existingError } = await supabaseAdmin
        .from("webhook_events")
        .select("id, provider, company_id, idempotency_key, status, error, received_at, processed_at")
        .eq("provider", providerKey)
        .eq("idempotency_key", idempotencyKey)
        .order("received_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing) {
        incrementMetric("webhook_ingest_total", {
          provider: providerKey,
          status: "duplicate",
          signature: verification.mode,
        });
        return okItem(toResponseItem(existing as WebhookEventRow, true, verification.mode));
      }

      if (existingError) {
        const fallbackExisting = findFallbackWebhookEvent(providerKey, idempotencyKey);
        if (fallbackExisting) {
          incrementMetric("webhook_ingest_total", {
            provider: providerKey,
            status: "duplicate",
            signature: verification.mode,
          });
          return okItem(toResponseItem(fallbackExisting, true, verification.mode));
        }
      }
    }

    const nowIso = new Date().toISOString();
    const status = verification.ok
      ? verification.mode === "verified"
        ? "received"
        : "received_unverified"
      : "rejected_signature";

    const eventPayload = {
      provider: providerKey,
      company_id: null,
      idempotency_key: idempotencyKey,
      headers_hash: headersHash,
      body_hash: bodyHash,
      status,
      error: verification.ok ? null : verification.error ?? "Signature verification failed",
      received_at: nowIso,
      processed_at: nowIso,
      payload: {
        headers: normalizedHeaders,
        body: rawBody,
      },
      updated_at: nowIso,
    };

    if (!supabaseAdmin) {
      const fallbackCreated = createFallbackWebhookEvent({
        provider: providerKey,
        idempotencyKey,
        status,
        error: verification.ok ? null : verification.error ?? "Signature verification failed",
      });
      incrementMetric("webhook_ingest_total", {
        provider: providerKey,
        status,
        signature: verification.mode,
      });
      if (!verification.ok) {
        incrementMetric("webhook_failures_total", { provider: providerKey });
      }
      return okItem(toResponseItem(fallbackCreated, false, verification.mode));
    }

    const { data, error } = await supabaseAdmin
      .from("webhook_events")
      .insert(eventPayload)
      .select("id, provider, company_id, idempotency_key, status, error, received_at, processed_at")
      .single();

    if (error || !data) {
      const fallbackCreated = createFallbackWebhookEvent({
        provider: providerKey,
        idempotencyKey,
        status,
        error: verification.ok ? null : verification.error ?? "Signature verification failed",
      });
      incrementMetric("webhook_ingest_total", {
        provider: providerKey,
        status,
        signature: verification.mode,
      });
      if (!verification.ok) {
        incrementMetric("webhook_failures_total", { provider: providerKey });
      }
      return okItem(toResponseItem(fallbackCreated, false, verification.mode));
    }

    incrementMetric("webhook_ingest_total", {
      provider: providerKey,
      status,
      signature: verification.mode,
    });
    if (!verification.ok) {
      incrementMetric("webhook_failures_total", { provider: providerKey });
    }
    return okItem(toResponseItem(data as WebhookEventRow, false, verification.mode));
  } catch {
    return serverError();
  }
}
