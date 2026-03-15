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
