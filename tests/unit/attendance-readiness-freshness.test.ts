import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  newestReadinessReport,
  shouldAcceptReadinessReport,
} from "../../src/lib/attendance/readinessReport.ts";

test("a stale broken readiness report cannot replace a newer configured report", () => {
  const configured = {
    reportedAt: "2026-08-11T12:05:00.000Z",
    configured: true,
    registeredRegionIds: ["shop:arrival"],
  };
  const staleBroken = {
    reportedAt: "2026-08-11T12:04:59.000Z",
    configured: false,
    registeredRegionIds: [],
  };

  assert.equal(shouldAcceptReadinessReport(configured.reportedAt, staleBroken.reportedAt), false);
  assert.deepEqual(newestReadinessReport(configured, staleBroken), configured);
});

test("the database enforces latest-captured readiness for concurrent API writes", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const migration = readFileSync(
    join(root, "supabase/migrations/20260811_01_attendance_readiness_freshness.sql"),
    "utf8"
  );
  assert.match(migration, /new\.native_readiness_reported_at <= old\.native_readiness_reported_at/);
  assert.match(migration, /new\.registered_region_ids := old\.registered_region_ids/);
  assert.match(migration, /before update on public\.employee_location_permissions/);
});
