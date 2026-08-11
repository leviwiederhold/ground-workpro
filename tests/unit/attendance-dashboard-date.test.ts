import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  companyLocalDayUtcBounds,
  resolveAttendanceDateKey,
  shiftAttendanceDateKey,
  timestampIsOnAttendanceDate,
} from "../../src/lib/attendance/dashboardDate.ts";

test("historical activity cannot appear in Today's Activity", () => {
  const timezone = "America/New_York";
  const today = "2026-08-11";
  const timestamps = [
    "2026-08-11T03:59:59.999Z", // Aug 10 at the company
    "2026-08-11T04:00:00.000Z", // Aug 11 at the company
    "2026-08-12T03:59:59.999Z", // still Aug 11 at the company
    "2026-08-12T04:00:00.000Z", // Aug 12 at the company
  ];
  assert.deepEqual(
    timestamps.filter((timestamp) => timestampIsOnAttendanceDate(timestamp, today, timezone)),
    ["2026-08-11T04:00:00.000Z", "2026-08-12T03:59:59.999Z"]
  );
});

test("company-local day bounds handle DST instead of assuming 24 UTC hours", () => {
  assert.deepEqual(companyLocalDayUtcBounds("2026-03-08", "America/New_York"), {
    startInclusive: "2026-03-08T05:00:00.000Z",
    endExclusive: "2026-03-09T04:00:00.000Z",
  });
  assert.deepEqual(companyLocalDayUtcBounds("2026-11-01", "America/New_York"), {
    startInclusive: "2026-11-01T04:00:00.000Z",
    endExclusive: "2026-11-02T05:00:00.000Z",
  });
});

test("previous-day history is addressable and Today resolves back to live company time", () => {
  const liveNow = "2026-08-11T03:30:00.000Z";
  const today = resolveAttendanceDateKey("today", liveNow, "America/New_York");
  assert.equal(today, "2026-08-10");
  assert.equal(shiftAttendanceDateKey(today!, -1), "2026-08-09");
  assert.equal(
    resolveAttendanceDateKey("today", "2026-08-11T04:00:00.000Z", "America/New_York"),
    "2026-08-11"
  );
});

test("CEO history query and controls are date-scoped and employee-invisible", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const route = readFileSync(join(root, "app/api/jobsite-time/timecards/route.ts"), "utf8");
  const view = readFileSync(join(root, "app/components/views/JobsiteTimeView.tsx"), "utf8");
  assert.match(route, /if \(selectedDate\) query = query\.eq\("work_date", selectedDate\)/);
  assert.match(route, /\.gte\("occurred_at", bounds\.startInclusive\)/);
  assert.match(route, /\.lt\("occurred_at", bounds\.endExclusive\)/);
  assert.match(route, /requestedDate && !isManager/);
  assert.match(view, /Previous day/);
  assert.match(view, /Next day/);
  assert.match(view, /aria-label="Attendance date"/);
  assert.match(view, /setFollowingToday\(true\)/);
  assert.match(view, /p\.set\(["']date["'], requestedAttendanceDate\)/);
});
