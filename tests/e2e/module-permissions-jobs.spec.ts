import { expect, test } from "@playwright/test";

const applyJobsAccess = async (
  page: Parameters<typeof test>[0]["page"],
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
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) {
    test.skip(true, "E2E_EMAIL and E2E_PASSWORD are required");
  }

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

  const setPm = await page.request.post("/api/test/set-role", {
    data: { role: "pm" },
  });
  expect(setPm.status()).toBe(200);

  await applyJobsAccess(page, "edit");

  const jobsCreateAllowed = await page.request.post("/api/jobs", {
    data: { name: `perm-edit-${Date.now()}`, status: "in_progress" },
  });
  expect(jobsCreateAllowed.status()).toBe(200);
});
