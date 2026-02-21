import * as Sentry from "@sentry/nextjs";
import { logServer } from "@/lib/observability/serverLog";

export type ApiErrorContext = {
  route?: string;
  companyId?: string | null;
  userId?: string | null;
  role?: string | null;
  status?: number;
  code?: string;
  details?: unknown;
};

export function captureApiError(error: unknown, context: ApiErrorContext = {}) {
  const tags: Record<string, string> = {};
  if (context.route) tags.route = context.route;
  if (context.companyId) tags.companyId = context.companyId;
  if (context.userId) tags.userId = context.userId;
  if (context.role) tags.role = context.role;

  const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : "Unknown error");

  logServer("error", "api_error", {
    message: err.message,
    stack: err.stack,
    ...context,
  });

  Sentry.withScope((scope) => {
    Object.entries(tags).forEach(([key, value]) => scope.setTag(key, value));
    if (context.status) scope.setTag("status", String(context.status));
    if (context.code) scope.setTag("code", context.code);
    if (context.details !== undefined) scope.setExtra("details", context.details);
    Sentry.captureException(err);
  });
}
