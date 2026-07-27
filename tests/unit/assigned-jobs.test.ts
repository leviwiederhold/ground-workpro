import test from "node:test";
import assert from "node:assert/strict";
import { makeDb } from "./helpers/fakeSupabase.ts";
import { resolveAssignedJobs } from "../../src/lib/jobsite-time/assignedJobs.ts";

const COMPANY = "company-1";
const OTHER_COMPANY = "company-2";
const USER = "user-1";

function baseTables() {
  return {
    employees: [{ id: "emp-1", company_id: COMPANY, user_id: USER }],
    job_employees: [] as Array<Record<string, unknown>>,
    jobs: [
      { id: "job-1", company_id: COMPANY, name: "Shop", lat: 39.32, lng: -84.36, address_verified: true },
      { id: "job-2", company_id: COMPANY, name: "Other", lat: 40.0, lng: -83.0, address_verified: true },
    ] as Array<Record<string, unknown>>,
  };
}

test("an employee assigned through job_employees receives the job", async () => {
  const tables = baseTables();
  tables.job_employees.push({ id: "je-1", company_id: COMPANY, employee_id: "emp-1", job_id: "job-1" });
  const jobs = await resolveAssignedJobs(makeDb(tables), COMPANY, USER);
  assert.equal(jobs.length, 1, "exactly the assigned job");
  assert.equal(jobs[0].jobId, "job-1");
  assert.equal(jobs[0].name, "Shop");
  assert.equal(jobs[0].addressVerified, true, "verified job with coordinates");
});

test("an unassigned employee receives no jobs", async () => {
  const tables = baseTables(); // employee row exists, but no job_employees rows
  const jobs = await resolveAssignedJobs(makeDb(tables), COMPANY, USER);
  assert.deepEqual(jobs, [], "no assignment → no jobs");
});

test("a user with no employee record receives no jobs", async () => {
  const tables = baseTables();
  tables.employees = [];
  tables.job_employees.push({ id: "je-1", company_id: COMPANY, employee_id: "emp-1", job_id: "job-1" });
  const jobs = await resolveAssignedJobs(makeDb(tables), COMPANY, USER);
  assert.deepEqual(jobs, [], "no employee row → no jobs");
});

test("assignments are company-scoped — a foreign-company assignment is ignored", async () => {
  const tables = baseTables();
  // An assignment row that belongs to another company must not leak through.
  tables.job_employees.push({ id: "je-x", company_id: OTHER_COMPANY, employee_id: "emp-1", job_id: "job-1" });
  const jobs = await resolveAssignedJobs(makeDb(tables), COMPANY, USER);
  assert.deepEqual(jobs, [], "cross-company assignment must not be returned");
});

test("only assigned jobs are returned, not every company job", async () => {
  const tables = baseTables();
  tables.job_employees.push({ id: "je-1", company_id: COMPANY, employee_id: "emp-1", job_id: "job-2" });
  const jobs = await resolveAssignedJobs(makeDb(tables), COMPANY, USER);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].jobId, "job-2", "returns the assigned job, not the unassigned Shop");
});

test("addressVerified is false when the assigned job lacks coordinates", async () => {
  const tables = baseTables();
  tables.jobs.push({ id: "job-3", company_id: COMPANY, name: "Unmapped", lat: null, lng: null, address_verified: true });
  tables.job_employees.push({ id: "je-1", company_id: COMPANY, employee_id: "emp-1", job_id: "job-3" });
  const jobs = await resolveAssignedJobs(makeDb(tables), COMPANY, USER);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].addressVerified, false, "verified flag requires real coordinates");
});
