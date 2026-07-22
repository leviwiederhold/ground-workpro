import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { makeDb, denyWritesTo } from "./helpers/fakeSupabase.ts";
import { AttendanceWriteError, assertWrite } from "../../src/lib/attendance/attendanceDb.ts";
import { applyClockInDecision } from "../../src/lib/attendance/scheduledClockInRunner.ts";
import { applyClockOutDecision } from "../../src/lib/attendance/departureRunner.ts";
import { applyGeofenceDecision } from "../../src/lib/attendance/geofenceEventRunner.ts";
import { decideGeofenceEvent } from "../../src/lib/attendance/geofenceEvent.ts";
import { finalizePendingAttendance } from "../../src/lib/jobsite-time/finalizeAttendance.ts";

// ── The policies themselves ──────────────────────────────────────────────────
//
// Asserted against the FINAL state of every migration applied in order, not
// against one file. A later migration that re-widens these tables fails here.

const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const ATTENDANCE_TABLES = ["jobsite_timecards", "jobsite_timecard_events"];

type Policy = { name: string; table: string; command: string };

/** Replay every migration in filename order and return the surviving policies. */
function resolvePolicies(): Map<string, Policy> {
  const live = new Map<string, Policy>();
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");

    for (const m of sql.matchAll(/drop\s+policy\s+(?:if\s+exists\s+)?(\w+)\s+on\s+public\.(\w+)/gi)) {
      live.delete(`${m[2]}.${m[1]}`);
    }
    for (const m of sql.matchAll(
      /create\s+policy\s+(\w+)\s+on\s+public\.(\w+)\s+for\s+(all|select|insert|update|delete)/gi
    )) {
      live.set(`${m[2]}.${m[1]}`, { name: m[1], table: m[2], command: m[3].toLowerCase() });
    }
  }
  return live;
}

test("authenticated users may read attendance records", () => {
  const live = resolvePolicies();
  for (const table of ATTENDANCE_TABLES) {
    const policies = [...live.values()].filter((p) => p.table === table);
    assert.ok(
      policies.some((p) => p.command === "select"),
      `${table} must keep a SELECT policy — the read paths use the caller's session client`
    );
  }
});

test("authenticated users may not write attendance records", () => {
  const live = resolvePolicies();
  for (const table of ATTENDANCE_TABLES) {
    const writable = [...live.values()].filter(
      (p) => p.table === table && ["all", "insert", "update", "delete"].includes(p.command)
    );
    assert.deepEqual(
      writable.map((p) => `${p.name} (for ${p.command})`),
      [],
      `${table} must not grant writes to authenticated users. Attendance is written ` +
        "only by the service-role client, which bypasses RLS."
    );
  }
});

test("the correction and audit tables are not writable either", () => {
  const live = resolvePolicies();
  // attendance_corrections is read-only by design; the credential, device-audit
  // and scheduler tables carry no policy at all (RLS on, deny-all).
  for (const table of [
    "attendance_corrections",
    "attendance_event_audit",
    "device_attendance_credentials",
    "attendance_scheduler_runs",
  ]) {
    const writable = [...live.values()].filter(
      (p) => p.table === table && ["all", "insert", "update", "delete"].includes(p.command)
    );
    assert.deepEqual(writable.map((p) => p.name), [], `${table} must not grant writes to authenticated users`);
  }
});

test("row level security is enabled on both attendance tables", () => {
  const all = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
    .join("\n");
  for (const table of ATTENDANCE_TABLES) {
    assert.match(
      all,
      new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, "i"),
      `${table} must have RLS enabled — without it the policies above are inert`
    );
  }
});

// ── Denied writes are never reported as success ──────────────────────────────

const DENIED = /row-level security/;

test("assertWrite raises on a rejected write and passes an empty match through", () => {
  assert.throws(
    () => assertWrite({ error: { message: "denied" } }, "clock_in"),
    (e: unknown) => e instanceof AttendanceWriteError && /clock_in/.test((e as Error).message)
  );
  // A guarded update matching no row is a race, not a failure.
  assert.doesNotThrow(() => assertWrite({ error: null }, "clock_in"));
});

function clockInRow() {
  return {
    id: "tc-1",
    company_id: "co-1",
    job_id: "job-1",
    employee_id: "emp-1",
    user_id: "user-1",
    work_date: "2026-07-21",
    scheduled_start: "2026-07-21T11:00:00.000Z",
    clock_in_at: null,
    clock_out_at: null,
    pending_arrival_at: "2026-07-21T10:50:00.000Z",
    pending_departure_at: null,
    onsite_before_shift_at: null,
    detected_arrival_at: null,
  };
}

test("a denied clock-in write throws instead of reporting a clock-in", async () => {
  const row = clockInRow();
  const db = makeDb({ jobsite_timecards: [row] }, denyWritesTo("jobsite_timecards"));
  await assert.rejects(
    () =>
      applyClockInDecision(
        db as never,
        row as never,
        { action: "clock_in", effectiveAt: "2026-07-21T11:00:00.000Z", backfilled: false, method: "arrival" },
        "2026-07-21T11:00:00.000Z"
      ),
    (e: unknown) => e instanceof AttendanceWriteError && DENIED.test((e as Error).message)
  );
  // And the record is genuinely unchanged — no phantom clock-in.
  assert.equal(row.clock_in_at, null);
});

test("a denied clock-out write throws instead of reporting a clock-out", async () => {
  const row = {
    id: "tc-1",
    company_id: "co-1",
    job_id: "job-1",
    employee_id: "emp-1",
    user_id: "user-1",
    clock_in_at: "2026-07-21T11:00:00.000Z",
    clock_out_at: null,
    break_start_at: null,
    break_end_at: null,
    pending_departure_at: "2026-07-21T18:00:00.000Z",
    detected_departure_at: null,
  };
  const db = makeDb({ jobsite_timecards: [row] }, denyWritesTo("jobsite_timecards"));
  await assert.rejects(
    () =>
      applyClockOutDecision(
        db as never,
        row as never,
        {
          action: "clock_out",
          effectiveAt: "2026-07-21T18:00:00.000Z",
          backfilled: false,
          method: "departure_grace",
        },
        "2026-07-21T18:10:00.000Z"
      ),
    (e: unknown) => e instanceof AttendanceWriteError && DENIED.test((e as Error).message)
  );
  assert.equal(row.clock_out_at, null);
});

test("a denied geofence write throws instead of opening a phantom session", async () => {
  const decision = decideGeofenceEvent({
    transition: "enter",
    occurredAt: "2026-07-21T11:00:00.000Z",
    source: "jobsite_auto",
    evaluation: { reject: false, confidence: "high", needsReview: false, arrivalStatus: "on_time" },
    card: null,
    otherOpenCards: [],
    departureGraceMinutes: 10,
    requireApproval: false,
  });
  const db = makeDb({ jobsite_timecards: [] }, denyWritesTo("jobsite_timecards"));
  await assert.rejects(
    () =>
      applyGeofenceDecision(
        db as never,
        {
          companyId: "co-1",
          userId: "user-1",
          employeeId: "emp-1",
          jobId: "job-1",
          workDate: "2026-07-21",
          scheduledStart: null,
          scheduledEnd: null,
          radiusFeet: 300,
          source: "jobsite_auto",
          provenance: {
            event_source: "native_geofence",
            device_reported_at: "2026-07-21T11:00:00.000Z",
            server_received_at: "2026-07-21T11:00:01.000Z",
          },
          latitude: null,
          longitude: null,
          accuracyMeters: null,
        },
        decision,
        null
      ),
    (e: unknown) => e instanceof AttendanceWriteError && DENIED.test((e as Error).message)
  );
  assert.deepEqual(db.tables.jobsite_timecards, []);
});

test("a forged or dropped audit row is a failure, not a silent gap", async () => {
  // The timecard write succeeds; only the event table refuses. The trail is the
  // record of what the device reported — losing a row is unrecoverable, so it
  // must not pass quietly.
  const row = clockInRow();
  const db = makeDb(
    { jobsite_timecards: [row], jobsite_timecard_events: [] },
    denyWritesTo("jobsite_timecard_events")
  );
  await assert.rejects(
    () =>
      applyClockInDecision(
        db as never,
        row as never,
        { action: "clock_in", effectiveAt: "2026-07-21T11:00:00.000Z", backfilled: false, method: "arrival" },
        "2026-07-21T11:00:00.000Z"
      ),
    (e: unknown) => e instanceof AttendanceWriteError && /audit:/.test((e as Error).message)
  );
});

test("finalizePendingAttendance propagates a denied write instead of returning quietly", async () => {
  const row = clockInRow();
  const db = makeDb({ jobsite_timecards: [row] }, denyWritesTo("jobsite_timecards"));
  await assert.rejects(
    () =>
      finalizePendingAttendance({
        db: db as never,
        companyId: "co-1",
        arrivalConfirmationSeconds: 60,
        departureGraceMinutes: 10,
        now: "2026-07-21T11:30:00.000Z",
      }),
    (e: unknown) => e instanceof AttendanceWriteError
  );
});

test("finalizePendingAttendance propagates a denied READ too", async () => {
  // The regression this closes: `if (result.error || !result.data?.length) return;`
  // made a denied read look exactly like "nothing pending", so arrivals silently
  // stopped maturing with no error anywhere.
  const db = makeDb({ jobsite_timecards: [clockInRow()] }, () => "permission denied for table jobsite_timecards");
  await assert.rejects(
    () =>
      finalizePendingAttendance({
        db: db as never,
        companyId: "co-1",
        arrivalConfirmationSeconds: 60,
        departureGraceMinutes: 10,
        now: "2026-07-21T11:30:00.000Z",
      }),
    (e: unknown) => e instanceof AttendanceWriteError && /load_open_cards/.test((e as Error).message)
  );
});

test("a healthy write path still succeeds and is not made brittle by the guards", async () => {
  const row = clockInRow();
  const db = makeDb({ jobsite_timecards: [row], jobsite_timecard_events: [] });
  const outcome = await applyClockInDecision(
    db as never,
    row as never,
    { action: "clock_in", effectiveAt: "2026-07-21T11:00:00.000Z", backfilled: false, method: "arrival" },
    "2026-07-21T11:00:00.000Z"
  );
  assert.equal(outcome, "clocked_in");
  assert.equal(row.clock_in_at, "2026-07-21T11:00:00.000Z");
});
