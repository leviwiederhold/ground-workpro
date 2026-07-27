// Server-side scheduled reconciliation for automatic attendance — BOTH halves.
//
// Invoked by Vercel Cron every minute (GET with `Authorization: Bearer
// $CRON_SECRET`), by an external scheduler (POST with
// `x-attendance-scheduler-secret`), or manually by a company admin for
// diagnostics. It creates the 7:00 AM clock-in for an employee who arrived at
// 6:50 and never opened the app, and it confirms the clock-out once a departure
// has survived the grace period — NOT a WebView timer, and not anything that
// requires the phone to be awake.
//
// The handler is intentionally thin: all decisions live in the pure modules
// (scheduledClockIn.ts, departure.ts) and the DB passes live in their runners,
// so both are unit-testable without a request.
//
// Order matters: arrivals run first, so an employee who arrives and departs
// within a single tick is clocked in before the departure pass considers them.

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { runScheduledAttendanceClockIn } from "@/lib/attendance/scheduledClockInRunner";
import { runScheduledAttendanceClockOut } from "@/lib/attendance/departureRunner";

export const dynamic = "force-dynamic";
// The pass is a bounded sweep (500 candidates); 60s is ample headroom.
export const maxDuration = 60;

type Trigger = "cron" | "scheduler_secret" | "admin";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Authorize the run. Machine callers use a shared secret; a human caller must be
 * an admin/manager of the company they are asking about — and is then scoped to
 * that company only, never to a cross-tenant sweep.
 */
async function authorize(
  request: Request
): Promise<{ ok: true; trigger: Trigger; companyId: string | null } | { ok: false; status: number; error: string }> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization") ?? "";
  if (cronSecret && authHeader.startsWith("Bearer ") && timingSafeEqual(authHeader.slice(7).trim(), cronSecret)) {
    return { ok: true, trigger: "cron", companyId: null };
  }

  const schedulerSecret = process.env.ATTENDANCE_SCHEDULER_SECRET;
  const provided = request.headers.get("x-attendance-scheduler-secret");
  if (schedulerSecret && provided && timingSafeEqual(provided, schedulerSecret)) {
    return { ok: true, trigger: "scheduler_secret", companyId: null };
  }

  try {
    const session = await requireRole(["admin", "pm"]);
    return { ok: true, trigger: "admin", companyId: session.companyId };
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return { ok: false, status: error.status, error: error.message };
    }
    return { ok: false, status: 403, error: "Not permitted" };
  }
}

async function run(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // The sweep spans companies and runs without a user session, so it requires
  // the service-role client. Failing loudly beats silently never clocking
  // anyone in.
  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Attendance scheduler requires SUPABASE_SERVICE_ROLE_KEY" },
      { status: 503 }
    );
  }

  const startedAt = new Date().toISOString();
  const runRow = await admin
    .from("attendance_scheduler_runs")
    .insert({ started_at: startedAt, trigger: auth.trigger })
    .select("id")
    .maybeSingle();
  const runId = runRow.data?.id ?? null;

  try {
    const arrivals = await runScheduledAttendanceClockIn({
      db: admin,
      now: startedAt,
      companyId: auth.companyId,
    });
    const departures = await runScheduledAttendanceClockOut({
      db: admin,
      now: startedAt,
      companyId: auth.companyId,
    });
    if (runId) {
      await admin
        .from("attendance_scheduler_runs")
        .update({
          finished_at: new Date().toISOString(),
          candidates: arrivals.candidates + departures.candidates,
          clocked_in: arrivals.clockedIn,
          backfilled: arrivals.backfilled,
          rejected: arrivals.rejected,
          suppressed: arrivals.suppressed + departures.suppressed,
          waiting: arrivals.waiting + departures.holding,
          clocked_out: departures.clockedOut,
          fallback_clocked_out: departures.fallbackClockedOut,
          departures_cancelled: departures.cancelled,
        })
        .eq("id", runId);
    }
    return NextResponse.json({ ok: true, trigger: auth.trigger, arrivals, departures });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scheduled clock-in failed";
    if (runId) {
      await admin
        .from("attendance_scheduler_runs")
        .update({ finished_at: new Date().toISOString(), error: message })
        .eq("id", runId);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Vercel Cron issues GET.
export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
