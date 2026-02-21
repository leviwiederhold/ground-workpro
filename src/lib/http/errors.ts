import { NextResponse } from "next/server";
import { captureApiError, type ApiErrorContext } from "@/lib/observability/captureApiError";
import { incrementMetric } from "@/lib/observability/metrics";

type ValidationDetail = {
  path: string;
  message: string;
};

export function badRequest(error: string, details?: unknown) {
  incrementMetric("http_errors_total", { status: 400, route: "unknown" });
  return NextResponse.json(details === undefined ? { error } : { error, details }, { status: 400 });
}

export function forbidden(error = "Forbidden") {
  incrementMetric("http_errors_total", { status: 403, route: "unknown" });
  return NextResponse.json({ error }, { status: 403 });
}

export function notFound(error: string) {
  incrementMetric("http_errors_total", { status: 404, route: "unknown" });
  return NextResponse.json({ error }, { status: 404 });
}

export function validationError(details: ValidationDetail[]) {
  incrementMetric("http_errors_total", { status: 422, route: "unknown" });
  return NextResponse.json({ error: "Validation error", details }, { status: 422 });
}

export function serverError(error = "Internal server error", details?: unknown, context?: ApiErrorContext) {
  incrementMetric("http_errors_total", {
    status: 500,
    route: context?.route ?? "unknown",
  });
  captureApiError(new Error(error), {
    status: 500,
    details,
    ...context,
  });
  return NextResponse.json(details === undefined ? { error } : { error, details }, { status: 500 });
}
