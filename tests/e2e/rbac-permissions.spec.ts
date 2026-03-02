import { expect, test, type Page } from "@playwright/test";
import { loginViaUI } from "./helpers";

async function setRole(page: Page, role: "admin" | "pm" | "foreman" | "mechanic" | "operator") {
  const response = await page.request.post("/api/test/set-role", { data: { role } });
  const body = await response.text();
  expect(response.status(), body).toBe(200);
  const json = JSON.parse(body);
  expect(json?.item?.role).toBe(role);
}

async function ensureActivePlan(page: Page) {
  const response = await page.request.post("/api/test/set-subscription", {
    data: { subscription_status: "active", plan_type: "starter" },
  });
  const body = await response.text();
  expect(response.status(), body).toBe(200);
}

test("RBAC forbids restricted actions by role and enforces cross-company isolation", async ({ page }) => {
  await loginViaUI(page);
  await setRole(page, "admin");
  await ensureActivePlan(page);

  const createBaseJobRes = await page.request.post("/api/jobs", {
    data: { name: `RBAC Base Job ${Date.now()}`, status: "draft" },
  });
  const createBaseJobBody = await createBaseJobRes.text();
  expect(createBaseJobRes.status(), createBaseJobBody).toBe(200);
  const baseJob = JSON.parse(createBaseJobBody)?.job;
  expect(baseJob?.id).toBeTruthy();

  await setRole(page, "operator");
  const operatorGetJobs = await page.request.get("/api/jobs");
  expect(operatorGetJobs.status()).toBe(200);

  const operatorCreateJob = await page.request.post("/api/jobs", {
    data: { name: `Operator Forbidden Job ${Date.now()}`, status: "draft" },
  });
  const operatorCreateJobBody = await operatorCreateJob.text();
  expect(operatorCreateJob.status(), operatorCreateJobBody).toBe(403);
  expect(JSON.parse(operatorCreateJobBody)).toEqual({ error: "Forbidden" });

  const operatorDeleteJob = await page.request.delete(`/api/jobs/${baseJob.id}`);
  const operatorDeleteJobBody = await operatorDeleteJob.text();
  expect(operatorDeleteJob.status(), operatorDeleteJobBody).toBe(403);
  expect(JSON.parse(operatorDeleteJobBody)).toEqual({ error: "Forbidden" });

  await setRole(page, "foreman");
  const foremanCreateJob = await page.request.post("/api/jobs", {
    data: { name: `Foreman Forbidden Job ${Date.now()}`, status: "draft" },
  });
  const foremanCreateJobBody = await foremanCreateJob.text();
  expect(foremanCreateJob.status(), foremanCreateJobBody).toBe(403);
  expect(JSON.parse(foremanCreateJobBody)).toEqual({ error: "Forbidden" });

  await setRole(page, "mechanic");
  const mechanicCreateJob = await page.request.post("/api/jobs", {
    data: { name: `Mechanic Forbidden Job ${Date.now()}`, status: "draft" },
  });
  const mechanicCreateJobBody = await mechanicCreateJob.text();
  expect(mechanicCreateJob.status(), mechanicCreateJobBody).toBe(403);
  expect(JSON.parse(mechanicCreateJobBody)).toEqual({ error: "Forbidden" });

  await setRole(page, "pm");
  const pmCreateJob = await page.request.post("/api/jobs", {
    data: { name: `PM Allowed Job ${Date.now()}`, status: "draft" },
  });
  const pmCreateJobBody = await pmCreateJob.text();
  expect(pmCreateJob.status(), pmCreateJobBody).toBe(200);
  expect(JSON.parse(pmCreateJobBody)?.job?.id).toBeTruthy();

  await setRole(page, "admin");
  const foreignFetch = await page.request.get(`/api/jobs/00000000-0000-0000-0000-000000000000/profitability`);
  const foreignFetchBody = await foreignFetch.text();
  expect(foreignFetch.status(), foreignFetchBody).toBe(404);
  expect(JSON.parse(foreignFetchBody)).toEqual({ error: "Job not found" });
});
