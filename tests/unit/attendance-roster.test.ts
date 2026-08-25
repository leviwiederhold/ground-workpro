import test from "node:test";
import assert from "node:assert/strict";
import {
  formatAttendanceRoleLabel,
  formatAssignedJobSubtitle,
} from "../../src/lib/jobsite-time/domain.ts";

// Regression for the Attendance roster subtitle bug: an employee with role
// "pm" and an assigned job used to render "pm · Unassigned". It must now render
// the canonical access-role terminology.
test("legacy pm + assigned job renders canonical role terminology", () => {
  const subtitle = formatAssignedJobSubtitle({
    role: "pm",
    jobName: "Smith Excavation",
    jobId: "42",
  });
  assert.equal(subtitle, "Manager - Smith Excavation");
  assert.doesNotMatch(subtitle, /·/); // no dot separator
  assert.doesNotMatch(subtitle, /unassigned/i); // not unassigned
});

test("legacy attendance role values display canonical access-role labels", () => {
  assert.equal(formatAttendanceRoleLabel("pm"), "Manager");
  assert.equal(formatAttendanceRoleLabel("owner"), "Owner");
  assert.equal(formatAttendanceRoleLabel("co_owner"), "Co-Owner");
  assert.equal(formatAttendanceRoleLabel("ceo"), "Co-Owner");
  assert.equal(formatAttendanceRoleLabel("admin"), "Co-Owner");
  assert.equal(formatAttendanceRoleLabel("foreman"), "Crew Lead");
  assert.equal(formatAttendanceRoleLabel("operator"), "Team Member");
  assert.equal(formatAttendanceRoleLabel("project manager"), "Manager");
  assert.equal(formatAttendanceRoleLabel(""), "Team Member");
  assert.equal(formatAttendanceRoleLabel(null), "Team Member");
});

test("job name from hydrated field is shown", () => {
  assert.equal(
    formatAssignedJobSubtitle({ role: "foreman", jobName: "BEAT Gym", jobId: 7 }),
    "Crew Lead - BEAT Gym"
  );
});

test("only shows Unassigned when there is truly no job id or name", () => {
  assert.equal(
    formatAssignedJobSubtitle({ role: "pm", jobName: null, jobId: null }),
    "Manager - Unassigned"
  );
  assert.equal(
    formatAssignedJobSubtitle({ role: "pm", jobName: "", jobId: "" }),
    "Manager - Unassigned"
  );
});

test("a bare jobId with no resolvable name is still treated as assigned", () => {
  // Should not read as "Unassigned" when an assignment id exists.
  assert.equal(
    formatAssignedJobSubtitle({ role: "operator", jobName: null, jobId: "99" }),
    "Team Member - Assigned job"
  );
});
