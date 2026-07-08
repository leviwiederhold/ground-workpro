import test from "node:test";
import assert from "node:assert/strict";
import {
  formatAttendanceRoleLabel,
  formatAssignedJobSubtitle,
} from "../../src/lib/jobsite-time/domain.ts";

// Regression for the Attendance roster subtitle bug: an employee with role
// "pm" and an assigned job used to render "pm · Unassigned". It must now render
// "PM - {Job Name}".
test("pm + assigned job renders 'PM - {Job Name}', not 'pm · Unassigned'", () => {
  const subtitle = formatAssignedJobSubtitle({
    role: "pm",
    jobName: "Smith Excavation",
    jobId: "42",
  });
  assert.equal(subtitle, "PM - Smith Excavation");
  assert.doesNotMatch(subtitle, /·/); // no dot separator
  assert.doesNotMatch(subtitle, /unassigned/i); // not unassigned
});

test("role labels: short codes/acronyms uppercased, others title-cased", () => {
  assert.equal(formatAttendanceRoleLabel("pm"), "PM");
  assert.equal(formatAttendanceRoleLabel("ceo"), "CEO");
  assert.equal(formatAttendanceRoleLabel("admin"), "ADMIN");
  assert.equal(formatAttendanceRoleLabel("foreman"), "Foreman");
  assert.equal(formatAttendanceRoleLabel("operator"), "Operator");
  assert.equal(formatAttendanceRoleLabel("project manager"), "Project Manager");
  assert.equal(formatAttendanceRoleLabel(""), "Employee");
  assert.equal(formatAttendanceRoleLabel(null), "Employee");
});

test("job name from hydrated field is shown", () => {
  assert.equal(
    formatAssignedJobSubtitle({ role: "foreman", jobName: "BEAT Gym", jobId: 7 }),
    "Foreman - BEAT Gym"
  );
});

test("only shows Unassigned when there is truly no job id or name", () => {
  assert.equal(
    formatAssignedJobSubtitle({ role: "pm", jobName: null, jobId: null }),
    "PM - Unassigned"
  );
  assert.equal(
    formatAssignedJobSubtitle({ role: "pm", jobName: "", jobId: "" }),
    "PM - Unassigned"
  );
});

test("a bare jobId with no resolvable name is still treated as assigned", () => {
  // Should not read as "Unassigned" when an assignment id exists.
  assert.equal(
    formatAssignedJobSubtitle({ role: "operator", jobName: null, jobId: "99" }),
    "Operator - Assigned job"
  );
});
