import { expect, test, type Page } from "@playwright/test";
import { getE2ECreds } from "./helpers";

const applyJobsAccess = async (
  page: Page,
  access: "none" | "view" | "edit"
) => {
  const response = await page.request.post("/api/test/module-permissions", {
    data: {
      permissions: [{ module_key: "jobs", access_level: access }],
    },
  });
  expect(response.status()).toBe(200);
};

test("module permissions enforce none/view/edit for jobs", async ({ page }) => {
  const { email, password } = getE2ECreds();
  const stamp = Date.now();

  const login = await page.request.post("/api/test/login", {
    data: { email, password },
  });
  expect(login.status()).toBe(200);

  const setOperator = await page.request.post("/api/test/set-role", {
    data: { role: "operator" },
  });
  expect(setOperator.status()).toBe(200);

  await applyJobsAccess(page, "none");

  const navNone = await page.request.get("/api/nav");
  expect(navNone.status()).toBe(200);
  const navNoneJson = await navNone.json();
  expect((navNoneJson?.items ?? []).some((item: { key?: string }) => item.key === "jobs")).toBeFalsy();

  const jobsNone = await page.request.get("/api/jobs");
  expect(jobsNone.status()).toBe(403);

  await applyJobsAccess(page, "view");

  const navView = await page.request.get("/api/nav");
  expect(navView.status()).toBe(200);
  const navViewJson = await navView.json();
  expect((navViewJson?.items ?? []).some((item: { key?: string }) => item.key === "jobs")).toBeTruthy();

  const jobsView = await page.request.get("/api/jobs");
  expect(jobsView.status()).toBe(200);
  const jobsViewJson = await jobsView.json();
  const jobsViewItems = Array.isArray(jobsViewJson?.items)
    ? jobsViewJson.items
    : Array.isArray(jobsViewJson?.jobs)
      ? jobsViewJson.jobs
      : [];
  expect(Array.isArray(jobsViewItems)).toBe(true);

  const jobsCreateBlocked = await page.request.post("/api/jobs", {
    data: { name: `perm-view-${Date.now()}`, status: "in_progress" },
  });
  expect(jobsCreateBlocked.status()).toBe(403);

  const viewJobSeed = await page.request.post("/api/jobs", {
    data: { name: `perm-view-seed-${Date.now()}`, status: "draft" },
  });
  expect(viewJobSeed.status()).toBe(403);

  const setPm = await page.request.post("/api/test/set-role", {
    data: { role: "pm" },
  });
  expect(setPm.status()).toBe(200);
  await applyJobsAccess(page, "edit");

  const visibleJobAResponse = await page.request.post("/api/jobs", {
    data: { name: `perm-visible-a-${stamp}`, status: "in_progress" },
  });
  expect(visibleJobAResponse.status()).toBe(200);
  const visibleJobA = (await visibleJobAResponse.json())?.job;
  expect(visibleJobA?.id).toBeTruthy();

  const visibleJobBResponse = await page.request.post("/api/jobs", {
    data: { name: `perm-visible-b-${stamp}`, status: "in_progress" },
  });
  expect(visibleJobBResponse.status()).toBe(200);
  const visibleJobB = (await visibleJobBResponse.json())?.job;
  expect(visibleJobB?.id).toBeTruthy();

  const employeesRes = await page.request.get("/api/employees");
  expect(employeesRes.status()).toBe(200);
  const employeesJson = await employeesRes.json();
  const existingEmployee = (employeesJson?.employees ?? []).find(
    (employee: Record<string, unknown>) => String(employee.email ?? "").toLowerCase() === email.toLowerCase()
  );

  let employeeId = existingEmployee?.id as string | undefined;
  if (!employeeId) {
    const createEmployeeRes = await page.request.post("/api/employees", {
      data: {
        name: `Jobs Perm Operator ${stamp}`,
        role: "Operator",
        email,
      },
    });
    expect(createEmployeeRes.status()).toBe(200);
    employeeId = (await createEmployeeRes.json())?.employee?.id;
  }
  expect(employeeId).toBeTruthy();

  const assignOperatorRes = await page.request.post(`/api/jobs/${visibleJobA.id}/employees`, {
    data: { employee_id: employeeId },
  });
  expect([200, 409]).toContain(assignOperatorRes.status());

  const setOperatorWithView = await page.request.post("/api/test/set-role", {
    data: { role: "operator" },
  });
  expect(setOperatorWithView.status()).toBe(200);
  await applyJobsAccess(page, "view");

  const operatorVisibleJobsRes = await page.request.get("/api/jobs?limit=50");
  expect(operatorVisibleJobsRes.status()).toBe(200);
  const operatorVisibleJobsJson = await operatorVisibleJobsRes.json();
  const operatorVisibleJobs = Array.isArray(operatorVisibleJobsJson?.items)
    ? operatorVisibleJobsJson.items
    : Array.isArray(operatorVisibleJobsJson?.jobs)
      ? operatorVisibleJobsJson.jobs
      : [];
  expect(operatorVisibleJobs.some((job: { id?: string | number }) => String(job.id) === String(visibleJobA.id))).toBe(true);
  expect(operatorVisibleJobs.some((job: { id?: string | number }) => String(job.id) === String(visibleJobB.id))).toBe(true);

  const operatorUnassignedDetailView = await page.request.get(`/api/jobs/${visibleJobB.id}`);
  expect(operatorUnassignedDetailView.status()).toBe(200);

  await applyJobsAccess(page, "edit");

  const operatorUnassignedDetailEdit = await page.request.get(`/api/jobs/${visibleJobB.id}`);
  expect(operatorUnassignedDetailEdit.status()).toBe(200);

  const operatorEditExistingJob = await page.request.patch(`/api/jobs/${visibleJobB.id}`, {
    data: { name: `perm-edit-visible-${stamp}` },
  });
  expect(operatorEditExistingJob.status()).toBe(200);
  const operatorEditExistingJobJson = await operatorEditExistingJob.json();
  expect(operatorEditExistingJobJson?.job?.name).toBe(`perm-edit-visible-${stamp}`);

  const jobsCreateAllowed = await page.request.post("/api/jobs", {
    data: { name: `perm-edit-${Date.now()}`, status: "in_progress" },
  });
  expect(jobsCreateAllowed.status()).toBe(200);
  const jobsCreateAllowedJson = await jobsCreateAllowed.json();
  const jobId = String(jobsCreateAllowedJson?.job?.id ?? "");
  expect(jobId).toBeTruthy();

  const jobsPatchAllowed = await page.request.patch(`/api/jobs/${jobId}`, {
    data: { name: `perm-edit-updated-${Date.now()}` },
  });
  expect(jobsPatchAllowed.status()).toBe(200);

  const jobsDeleteAllowed = await page.request.delete(`/api/jobs/${jobId}`);
  expect(jobsDeleteAllowed.status()).toBe(200);
});
