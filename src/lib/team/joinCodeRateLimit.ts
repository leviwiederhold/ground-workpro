import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/http/errorResponse";

type RateLimitRpcClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>
  ) => PromiseLike<{
    data: unknown;
    error: { message?: string | null } | null;
  }>;
};

type DistributedRateLimitOptions = {
  scope: string;
  limit: number;
  windowMs: number;
  subject?: string | null;
};

function getRequestIp(request: Request) {
  const forwarded =
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    "unknown"
  );
}

function createRateLimitKey(request: Request, options: DistributedRateLimitOptions) {
  const material = [
    "employee-join-code",
    options.scope,
    getRequestIp(request),
    String(options.subject ?? "anonymous"),
  ].join(":");
  return createHash("sha256").update(material, "utf8").digest("hex");
}

export async function enforceEmployeeJoinCodeRateLimit(
  request: Request,
  admin: RateLimitRpcClient,
  options: DistributedRateLimitOptions
): Promise<NextResponse | null> {
  const { data, error } = await admin.rpc("consume_employee_join_code_rate_limit", {
    p_rate_limit_key: createRateLimitKey(request, options),
    p_limit: options.limit,
    p_window_seconds: Math.max(1, Math.ceil(options.windowMs / 1000)),
  });

  if (error) {
    return errorResponse("Join code service is unavailable", 503);
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { allowed?: unknown; rate_limit_reset_at?: unknown }
    | null;
  if (!row || typeof row.allowed !== "boolean") {
    return errorResponse("Join code service is unavailable", 503);
  }
  if (row.allowed) return null;

  const resetAt = Date.parse(String(row.rate_limit_reset_at ?? ""));
  const retryAfterSeconds = Number.isFinite(resetAt)
    ? Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))
    : Math.max(1, Math.ceil(options.windowMs / 1000));
  return errorResponse("Too many requests", 429, {
    headers: { "Retry-After": String(retryAfterSeconds) },
  });
}
