import { NextResponse } from "next/server";
import { captureApiError, type ApiErrorContext } from "@/lib/observability/captureApiError";
import { incrementMetric } from "@/lib/observability/metrics";

type ErrorResponseOptions = {
  details?: unknown;
  headers?: HeadersInit;
  context?: ApiErrorContext;
};

export function errorResponse(
  error: string,
  status = 400,
  options: ErrorResponseOptions = {}
) {
  if (status >= 400) {
    incrementMetric("http_errors_total", {
      status,
      route: options.context?.route ?? "unknown",
    });
  }

  if (status >= 500) {
    captureApiError(new Error(error), {
      status,
      details: options.details,
      ...options.context,
    });
  }

  const payload: { error: string; details?: unknown } = { error };
  if (options.details !== undefined) {
    payload.details = options.details;
  }

  return NextResponse.json(payload, {
    status,
    headers: options.headers,
  });
}
