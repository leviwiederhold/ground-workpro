import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// The event_type CHECK constraint versus what the application actually writes.
//
// This is a STATIC check against migration source. It adds no runtime behavior
// and touches no database — it exists because the drift it catches is the most
// likely cause of a half-written attendance record: the timecard UPDATE
// succeeds, the audit INSERT is rejected by the constraint, and the two writes
// are not in one transaction.
//
// scripts/attendance-event-type-repair.sql exists because that drift has already
// happened once, when 20260721_01 and _02 were applied out of order and the
// departure event types were left out of the constraint.
//
// LIMIT OF THIS TEST: it proves the migrations and the code agree. It cannot
// prove a given database has those migrations applied — that needs a check
// against a live connection at deploy time, which is tracked separately.

const MIGRATIONS = join(process.cwd(), "supabase/migrations");

// Every module that writes a row to jobsite_timecard_events.
const EMITTING_SOURCES = [
  "src/lib/attendance/geofenceEvent.ts",
  "src/lib/attendance/scheduledClockInRunner.ts",
  "src/lib/attendance/departureRunner.ts",
  "src/lib/attendance/corrections.ts",
  "app/api/jobsite-time/timecards/[id]/route.ts",
  "app/api/attendance/corrections/route.ts",
];

// Permitted by the constraint but deliberately not emitted yet. Anything else
// the constraint allows but nothing writes is dead vocabulary and should be
// removed rather than quietly carried.
const RESERVED = new Set(["break_suggested"]);

/** The event types the constraint allows, after replaying every migration. */
function allowedEventTypes(): Set<string> {
  let allowed = new Set<string>();
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    // Each migration that changes the vocabulary drops the constraint and adds
    // it back in full, so the last definition wins.
    for (const m of sql.matchAll(
      /constraint\s+jobsite_timecard_events_event_type_check\s+check\s*\(\s*event_type\s+in\s*\(([\s\S]*?)\)\s*\)/gi
    )) {
      allowed = new Set([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
    }
    // The original table definition carries the constraint inline.
    if (allowed.size === 0) {
      const inline = sql.match(/event_type\s+text\s+not\s+null\s*check\s*\(\s*event_type\s+in\s*\(([\s\S]*?)\)\s*\)/i);
      if (inline) allowed = new Set([...inline[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
    }
  }
  return allowed;
}

/** The event types the application writes, read out of the source. */
function emittedEventTypes(): Map<string, string> {
  const byType = new Map<string, string>();
  const record = (value: string, file: string) => {
    for (const lit of value.matchAll(/"([a-z_]+)"/g)) {
      if (!byType.has(lit[1])) byType.set(lit[1], file);
    }
  };
  for (const file of EMITTING_SOURCES) {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    // `eventType: "x"` / `eventType = "x"` — but never `eventType === "x"`,
    // which is a comparison, not an emission.
    for (const m of source.matchAll(/eventType\s*(?::|=(?!=))\s*([^,;\n]+)/g)) record(m[1], file);
    for (const m of source.matchAll(/event_type:\s*([^,\n]+)/g)) record(m[1], file);
    // The third argument of logEvent(db, row, <type>, ...), which may be a
    // ternary picking between two types.
    for (const m of source.matchAll(/logEvent\(\s*db,\s*row,\s*([^,]*?),/g)) record(m[1], file);
  }
  return byType;
}

test("the migrations define an event_type constraint at all", () => {
  const allowed = allowedEventTypes();
  assert.ok(
    allowed.size > 0,
    "no jobsite_timecard_events_event_type_check constraint found in supabase/migrations"
  );
});

test("every event type the application writes is permitted by the constraint", () => {
  const allowed = allowedEventTypes();
  const emitted = emittedEventTypes();

  const rejected = [...emitted.entries()]
    .filter(([type]) => !allowed.has(type))
    .map(([type, file]) => `${type} (written by ${file})`);

  assert.deepEqual(
    rejected,
    [],
    "These event types would be REJECTED by the database CHECK constraint. The " +
      "timecard write would succeed and the audit insert would fail, leaving a " +
      "half-written record. Add them to jobsite_timecard_events_event_type_check " +
      "in a migration:\n  " +
      rejected.join("\n  ")
  );
});

test("the constraint permits nothing the application never writes", () => {
  const allowed = allowedEventTypes();
  const emitted = emittedEventTypes();

  const unused = [...allowed].filter((type) => !emitted.has(type) && !RESERVED.has(type)).sort();

  assert.deepEqual(
    unused,
    [],
    "The constraint allows event types nothing writes. Either the emitting code " +
      "was removed and the constraint should be narrowed, or this test's " +
      "EMITTING_SOURCES list is missing a file that writes them: " + unused.join(", ")
  );
});

test("the emitted set is discovered, not assumed", () => {
  // Guards the extractor itself: if a refactor changes how events are written
  // and these patterns stop matching, the two tests above would pass vacuously.
  const emitted = emittedEventTypes();
  assert.ok(emitted.size >= 15, `expected to find the attendance event types in source, found ${emitted.size}`);
  for (const anchor of ["entered_geofence", "auto_clock_in", "departure_pending", "monitoring_stopped"]) {
    assert.ok(emitted.has(anchor), `extractor failed to find ${anchor} — the patterns are stale`);
  }
});
