import assert from "node:assert/strict";
import test from "node:test";

import { buildAttendanceSetupRoster } from "../../src/lib/attendance/configuredEmployees.ts";

test("CEO setup count maps the authoritative permission report to employees exactly", () => {
  const result = buildAttendanceSetupRoster(
    [
      { id: "employee-a", name: "Ready", user_id: "user-a" },
      { id: "employee-b", name: "Incomplete", user_id: "user-b" },
      { id: "employee-c", name: "No app account", user_id: null },
    ],
    [
      { userId: "user-a", automaticAttendanceConfigured: true },
      { userId: "user-b", automaticAttendanceConfigured: false },
    ],
  );

  assert.equal(result.configuredCount, 1);
  assert.deepEqual(
    result.items.map((item) => ({ id: item.id, configured: item.configured })),
    [
      { id: "employee-a", configured: true },
      { id: "employee-b", configured: false },
    ],
  );
});

test("missing authoritative readiness is Not set up, never a false positive", () => {
  const result = buildAttendanceSetupRoster(
    [{ id: "employee-a", user_id: "user-a" }],
    [],
  );

  assert.equal(result.configuredCount, 0);
  assert.equal(result.items[0]?.configured, false);
});
