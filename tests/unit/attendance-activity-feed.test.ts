import test from "node:test";
import assert from "node:assert/strict";
import { buildAttendanceActivity, type AttendanceActivityCard } from "../../src/lib/attendance/activityFeed.ts";

function card(over: Partial<AttendanceActivityCard> = {}): AttendanceActivityCard {
  return {
    id: "tc-1",
    employeeId: "emp-1",
    userId: "user-1",
    jobId: "shop",
    workDate: "2026-08-24",
    clockInAt: "2026-08-24T12:03:00.000Z",
    clockOutAt: "2026-08-24T17:38:00.000Z",
    ...over,
  };
}

test("activity contains only today's confirmed business boundaries", () => {
  const activity = buildAttendanceActivity([
    card(),
    card({ id: "yesterday", workDate: "2026-08-23" }),
    card({ id: "pending", clockInAt: null, clockOutAt: null }),
  ], "2026-08-24");

  assert.deepEqual(activity.map((event) => event.type), ["departure", "arrival"]);
});

test("nearby technical confirmations collapse into one owner-facing event", () => {
  const activity = buildAttendanceActivity([
    card({ id: "native", clockOutAt: null }),
    card({ id: "foreground", clockInAt: "2026-08-24T12:04:30.000Z", clockOutAt: null }),
    card({ id: "scheduler", clockInAt: "2026-08-24T12:06:00.000Z", clockOutAt: null }),
  ], "2026-08-24");

  assert.equal(activity.length, 1);
  assert.equal(activity[0].type, "arrival");
  assert.equal(activity[0].occurredAt, "2026-08-24T12:03:00.000Z");
});

test("different employees, jobs, event types, and distinct visits remain visible", () => {
  const activity = buildAttendanceActivity([
    card({ id: "first", clockOutAt: null }),
    card({ id: "other-user", employeeId: "emp-2", userId: "user-2", clockOutAt: null }),
    card({ id: "other-job", jobId: "yard", clockOutAt: null }),
    card({ id: "later", clockInAt: "2026-08-24T13:03:01.000Z", clockOutAt: null }),
  ], "2026-08-24");

  assert.equal(activity.length, 4);
});
