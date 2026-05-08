import { expect, request as playwrightRequest, test, type Page } from "@playwright/test";

type Role = "admin" | "pm" | "foreman" | "mechanic" | "operator";

async function setRole(page: Page, role: Role) {
  const response = await page.request.post("/api/test/set-role", { data: { role }, timeout: 30_000 });
  const body = await response.text();
  expect(response.status(), body).toBe(200);
}

test("sensitive APIs reject lower roles and invalid uploads", async ({ page }) => {
  await setRole(page, "admin");

  const jobResponse = await page.request.post("/api/jobs", {
    data: { name: `Security Job ${Date.now()}`, status: "draft" },
  });
  const jobBody = await jobResponse.text();
  expect(jobResponse.status(), jobBody).toBe(200);
  const job = JSON.parse(jobBody).job;
  expect(job?.id).toBeTruthy();

  const employeeResponse = await page.request.post("/api/employees", {
    data: {
      name: `Security Employee ${Date.now()}`,
      role: "operator",
      hourlyRate: 21,
    },
  });
  const employeeBody = await employeeResponse.text();
  expect(employeeResponse.status(), employeeBody).toBe(200);
  const employee = JSON.parse(employeeBody).employee;
  expect(employee?.id).toBeTruthy();

  const badUpload = await page.request.post("/api/attachments/upload-url", {
    data: {
      entity_type: "job",
      entity_id: job.id,
      file_name: "payload.exe",
      content_type: "application/x-msdownload",
      file_size: 128,
    },
  });
  expect(badUpload.status()).toBe(400);

  const foreignPathConfirm = await page.request.post("/api/attachments/confirm", {
    data: {
      entity_type: "job",
      entity_id: job.id,
      bucket: "attachments",
      path: "00000000-0000-0000-0000-000000000000/job/1/file.pdf",
      file_name: "file.pdf",
      content_type: "application/pdf",
      file_size: 128,
    },
  });
  expect(foreignPathConfirm.status()).toBe(403);

  await setRole(page, "operator");

  const payroll = await page.request.get("/api/hours-payroll?range=week");
  expect(payroll.status()).toBe(403);

  const bidAnalytics = await page.request.get("/api/bids/analytics");
  expect(bidAnalytics.status()).toBe(403);

  const profitability = await page.request.get(`/api/jobs/${job.id}/profitability`);
  expect(profitability.status()).toBe(403);

  await setRole(page, "foreman");
  const safetySignoff = await page.request.post("/api/safety-logs", {
    data: {
      occurred_on: new Date().toISOString().slice(0, 10),
      summary: "Foreman attempted sign off",
      severity: "low",
      job_id: job.id,
    },
  });
  expect(safetySignoff.status()).toBe(403);

  await setRole(page, "pm");
  const payRateEdit = await page.request.patch(`/api/employees/${employee.id}`, {
    data: { hourlyRate: 99 },
  });
  expect(payRateEdit.status()).toBe(403);
});

test("unauthenticated sensitive requests fail", async ({ baseURL }) => {
  const anonymous = await playwrightRequest.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  });
  const responses = await Promise.all([
    anonymous.get("/api/hours-payroll?range=week").then((response) => ["payroll", response] as const),
    anonymous.get("/api/bids/analytics").then((response) => ["bid analytics", response] as const),
    anonymous.get("/api/pricing-settings").then((response) => ["pricing", response] as const),
    anonymous.get("/api/attachments?entity_type=document").then((response) => ["attachments", response] as const),
  ]);

  for (const [label, response] of responses) {
    expect([401, 403], label).toContain(response.status());
  }

  await anonymous.dispose();
});
