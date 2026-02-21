import { errorResponse } from "@/lib/http/errorResponse";
import { incrementMetric } from "@/lib/observability/metrics";

type RateLimitOptions = {
  keyPrefix: string;
  limit: number;
  windowMs: number;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const RATE_LIMIT_STORE_KEY = "__groundworkRateLimitStore__";

type GlobalWithRateLimit = typeof globalThis & {
  [RATE_LIMIT_STORE_KEY]?: Map<string, RateLimitEntry>;
};

const globalWithRateLimit = globalThis as GlobalWithRateLimit;
const rateLimitStore =
  globalWithRateLimit[RATE_LIMIT_STORE_KEY] ??
  (globalWithRateLimit[RATE_LIMIT_STORE_KEY] = new Map<string, RateLimitEntry>());

let cleanupTick = 0;

function getRequestIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

function cleanupExpiredEntries(now: number) {
  cleanupTick += 1;
  if (cleanupTick % 50 !== 0) return;

  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt <= now) {
      rateLimitStore.delete(key);
    }
  }
}

export function enforceRateLimit(request: Request, options: RateLimitOptions) {
  const now = Date.now();
  cleanupExpiredEntries(now);

  const ip = getRequestIp(request);
  const key = `${options.keyPrefix}:${ip}`;
  const current = rateLimitStore.get(key);

  if (!current || current.resetAt <= now) {
    rateLimitStore.set(key, {
      count: 1,
      resetAt: now + options.windowMs,
    });
    return null;
  }

  if (current.count >= options.limit) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((current.resetAt - now) / 1000)
    );
    incrementMetric("rate_limited_total", {
      keyPrefix: options.keyPrefix,
      limit: options.limit,
    });
    return errorResponse("Too many requests", 429, {
      headers: { "Retry-After": String(retryAfterSeconds) },
    });
  }

  current.count += 1;
  rateLimitStore.set(key, current);
  return null;
}
