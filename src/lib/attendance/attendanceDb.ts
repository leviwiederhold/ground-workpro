// Server-only database access for attendance writes.
//
// Since 20260722_01, `jobsite_timecards` and `jobsite_timecard_events` grant
// authenticated users SELECT and nothing else. Every write therefore has to go
// through the service-role client, and the routes may no longer fall back to the
// caller's session client the way they used to — under the new policy that
// fallback does not degrade gracefully, it fails.
//
// Two rules, both about making failure loud:
//
//  1. No service-role client → refuse the request outright. The alternative is
//     an endpoint that accepts an arrival and quietly records nothing.
//  2. A rejected write → throw. The appliers used to inspect `.data` and ignore
//     `.error`, so a denied UPDATE was indistinguishable from "another writer
//     got there first" and was reported as a successful no-op.
//
// The user-facing message deliberately says nothing about configuration. An
// employee seeing "SUPABASE_SERVICE_ROLE_KEY is missing" learns something about
// the deployment and can do nothing with it; the precise cause goes to the
// server log instead.

import { getSupabaseAdmin } from "../supabase/admin.ts";
import { logServer } from "../observability/serverLog.ts";

/** What an end user is told when attendance cannot be written. Stable copy. */
export const ATTENDANCE_UNAVAILABLE_MESSAGE = "Attendance service is temporarily unavailable.";

export class AttendanceWriteError extends Error {
  readonly operation: string;
  readonly cause: string;

  constructor(operation: string, cause: string) {
    super(`Attendance write failed (${operation}): ${cause}`);
    this.name = "AttendanceWriteError";
    this.operation = operation;
    this.cause = cause;
  }
}

/**
 * The service-role client, or null after logging precisely why it is absent.
 *
 * Callers that write must refuse the request when this returns null — see
 * ATTENDANCE_UNAVAILABLE_MESSAGE for what to tell the caller, and 503 for the
 * status (the deployment is misconfigured, the request was not).
 */
export function getAttendanceWriteDb(route: string): ReturnType<typeof getSupabaseAdmin> {
  const admin = getSupabaseAdmin();
  if (!admin) {
    logServer("error", "attendance.write_db_unavailable", {
      route,
      reason: "SUPABASE_SERVICE_ROLE_KEY is not configured; attendance writes require the service-role client",
    });
    return null;
  }
  return admin;
}

/**
 * Throw if a Supabase write returned an error.
 *
 * Note what this does NOT do: a result with `error: null` and `data: null` is
 * allowed through. That is the guarded-update case — `.is("clock_out_at", null)`
 * matching no row means a concurrent writer won the race, which is a legitimate
 * outcome the appliers already handle. Only an actual database error (including
 * an RLS denial) raises.
 */
export function assertWrite(result: { error?: { message?: string } | null } | null, operation: string): void {
  const message = result?.error?.message;
  if (message) {
    logServer("error", "attendance.write_failed", { operation, error: message });
    throw new AttendanceWriteError(operation, message);
  }
}
