import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACTIVE_JOB_STATUSES,
  ASSIGNMENT_CONFLICT_CODE,
  findActiveAssignmentConflict,
  isActiveJobStatus,
} from "../../src/lib/jobs/assignmentConflict.ts";
import {
  assignEmployeeToJob,
  reassignEmployeeToJob,
} from "../../src/lib/jobs/assignmentService.ts";

test("all current active job statuses participate in the one-active-job guard", () => {
  assert.deepEqual(ACTIVE_JOB_STATUSES, ["in_progress", "active", "open", "approved"]);
  for (const status of ACTIVE_JOB_STATUSES) assert.equal(isActiveJobStatus(status), true);
  assert.equal(isActiveJobStatus("completed"), false);
  assert.equal(isActiveJobStatus(null), false);
});

test("conflict detection ignores schedules and rejects any second active job", () => {
  const conflict = findActiveAssignmentConflict({
    targetJobId: "job-new",
    targetStatus: "active",
    existingJobs: [
      { id: "job-current", name: "Library", status: "approved" },
      { id: "job-old", name: "Finished", status: "completed" },
    ],
  });
  assert.deepEqual(conflict, { id: "job-current", name: "Library", status: "approved" });
});

test("inactive targets and the target's own membership are not conflicts", () => {
  const jobs = [{ id: "job-new", name: "Target", status: "active" }];
  assert.equal(
    findActiveAssignmentConflict({ targetJobId: "job-new", targetStatus: "completed", existingJobs: jobs }),
    null,
  );
  assert.equal(
    findActiveAssignmentConflict({ targetJobId: "job-new", targetStatus: "active", existingJobs: jobs }),
    null,
  );
});

test("assignment uses only the atomic RPC and returns the current job on conflict", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return {
        data: {
          ok: false,
          code: ASSIGNMENT_CONFLICT_CODE,
          current_job: { id: "job-current", name: "Library" },
        },
        error: null,
      };
    },
  };

  const result = await assignEmployeeToJob({
    supabase: client,
    companyId: "company-1",
    jobId: "job-new",
    employeeId: "employee-1",
  });

  assert.deepEqual(result, {
    status: "conflict",
    currentJob: { id: "job-current", name: "Library" },
  });
  assert.deepEqual(calls, [{
    name: "assign_job_employee",
    args: {
      p_company_id: "company-1",
      p_job_id: "job-new",
      p_employee_id: "employee-1",
      p_assigned_role: null,
    },
  }]);
});

test("a missing assignment RPC fails closed instead of using a non-atomic fallback", async () => {
  const result = await assignEmployeeToJob({
    supabase: {
      rpc: async () => ({
        data: null,
        error: { code: "PGRST202", message: "Could not find the function" },
      }),
    },
    companyId: "company-1",
    jobId: "job-new",
    employeeId: "employee-1",
  });
  assert.equal(result.status, "unavailable");
});

test("confirmed reassignment sends both job IDs to one database RPC", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const result = await reassignEmployeeToJob({
    supabase: {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return { data: { ok: true, status: "reassigned" }, error: null };
      },
    },
    companyId: "company-1",
    fromJobId: "job-current",
    toJobId: "job-new",
    employeeId: "employee-1",
    assignedRole: "Foreman",
  });

  assert.deepEqual(result, { status: "reassigned" });
  assert.deepEqual(calls, [{
    name: "reassign_job_employee",
    args: {
      p_company_id: "company-1",
      p_from_job_id: "job-current",
      p_to_job_id: "job-new",
      p_employee_id: "employee-1",
      p_assigned_role: "Foreman",
    },
  }]);
});

test("migration enforces future writes atomically without remediating existing rows", () => {
  const root = process.cwd();
  const migration = readFileSync(
    join(root, "supabase/migrations/20260808_01_atomic_job_assignments.sql"),
    "utf8",
  );

  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /create trigger job_employees_one_active_job_insert_guard/);
  assert.match(migration, /create trigger job_employees_one_active_job_update_guard/);
  assert.match(migration, /create trigger jobs_activation_assignment_guard/);
  assert.match(migration, /create or replace function public\.reassign_job_employee/);
  assert.match(migration, /These writes are one database transaction/);
  assert.equal((migration.match(/delete from public\.job_employees/g) ?? []).length, 1);
  assert.doesNotMatch(migration, /update public\.employees/);
  assert.doesNotMatch(migration, /date_range|schedule_overlap|scheduled_start|scheduled_end/i);
  assert.match(migration, /does not delete, rewrite, or choose among any[\s\S]*existing multi-job rows/);
});

test("routes fail closed and the CEO dialog names the employee's current job", () => {
  const root = process.cwd();
  const assignRoute = readFileSync(
    join(root, "app/api/jobs/[id]/employees/route.ts"),
    "utf8",
  );
  const reassignRoute = readFileSync(
    join(root, "app/api/jobs/[id]/employees/reassign/route.ts"),
    "utf8",
  );
  const employeeRoute = readFileSync(
    join(root, "app/api/employees/[id]/route.ts"),
    "utf8",
  );
  const service = readFileSync(join(root, "src/lib/jobs/assignmentService.ts"), "utf8");
  const jobsView = readFileSync(join(root, "app/components/views/JobsView.tsx"), "utf8");
  const teamView = readFileSync(join(root, "app/page.tsx"), "utf8");

  assert.match(assignRoute, /assignEmployeeToJob/);
  assert.match(reassignRoute, /reassignEmployeeToJob/);
  assert.match(employeeRoute, /assignEmployeeToJob/);
  assert.match(employeeRoute, /EMPLOYEE_ASSIGNMENT_REMEDIATION_REQUIRED/);
  assert.doesNotMatch(assignRoute, /from\("job_employees"\)[\s\S]{0,250}\.insert/);
  assert.doesNotMatch(reassignRoute, /from\("job_employees"\)[\s\S]{0,250}\.delete/);
  assert.doesNotMatch(employeeRoute, /from\("job_employees"\)[\s\S]{0,250}\.insert/);
  assert.doesNotMatch(service, /\.from\(/);
  assert.match(jobsView, /payload\?\.currentJob\?\.name/);
  assert.match(jobsView, /Employee already assigned/);
  assert.match(jobsView, />\s*Cancel\s*</);
  assert.match(jobsView, /Remove from current job and assign to new job/);
  assert.match(teamView, /setTeamReassignPrompt/);
  assert.match(teamView, /teamReassignPrompt\?\.currentJobName/);
  assert.match(teamView, /Remove from current job and assign to new job/);
});
