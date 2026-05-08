import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { loginViaUI } from "./helpers";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";

async function setRole(page: Page, role: "admin" | "pm" | "foreman" | "mechanic" | "operator") {
  const response = await page.request.post("/api/test/set-role", { data: { role }, timeout: 30_000 });
  const body = await response.text();
  expect(response.status(), body).toBe(200);
  await page.context().addCookies([{ name: "e2e_role", value: role, url: BASE_URL }]);
}

async function getTimeClockStatus(request: APIRequestContext) {
  const response = await request.get("/api/time-clock", { timeout: 30_000 });
  const body = await response.text();
  expect(response.status(), body).toBe(200);
  return JSON.parse(body)?.item ?? {};
}

async function clockOutIfNeeded(request: APIRequestContext) {
  const status = await getTimeClockStatus(request);
  if (String(status?.status) !== "clocked_in") return;
  const response = await request.post("/api/time-clock/clock-out", { timeout: 30_000 });
  const body = await response.text();
  expect([200, 409], body).toContain(response.status());
}

test.describe("time clock", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginViaUI(page);
    await clockOutIfNeeded(page.request);
    await context.close();
  });

  test("clock in", async ({ page }) => {
    await loginViaUI(page);
    await clockOutIfNeeded(page.request);

    const clockInResponse = await page.request.post("/api/time-clock/clock-in", { timeout: 30_000 });
    const clockInBody = await clockInResponse.text();
    expect(clockInResponse.status(), clockInBody).toBe(200);

    const status = await getTimeClockStatus(page.request);
    expect(String(status?.status)).toBe("clocked_in");
    expect(status?.activeShiftStartAt).toBeTruthy();
  });

  test("cannot double clock in", async ({ page }) => {
    await loginViaUI(page);
    const firstStatus = await getTimeClockStatus(page.request);
    if (String(firstStatus?.status) !== "clocked_in") {
      const seedClockIn = await page.request.post("/api/time-clock/clock-in", { timeout: 30_000 });
      expect([200, 409]).toContain(seedClockIn.status());
    }

    const response = await page.request.post("/api/time-clock/clock-in", { timeout: 30_000 });
    const body = await response.text();
    expect(response.status(), body).toBe(409);
  });

  test("clock out", async ({ page }) => {
    await loginViaUI(page);
    const status = await getTimeClockStatus(page.request);
    if (String(status?.status) !== "clocked_in") {
      const seedClockIn = await page.request.post("/api/time-clock/clock-in", { timeout: 30_000 });
      expect([200, 409]).toContain(seedClockIn.status());
    }

    const clockOutResponse = await page.request.post("/api/time-clock/clock-out", { timeout: 30_000 });
    const clockOutBody = await clockOutResponse.text();
    expect(clockOutResponse.status(), clockOutBody).toBe(200);

    const after = await getTimeClockStatus(page.request);
    expect(String(after?.status)).toBe("clocked_out");
  });

  test("cannot clock out when not clocked in", async ({ page }) => {
    await loginViaUI(page);
    await clockOutIfNeeded(page.request);

    const response = await page.request.post("/api/time-clock/clock-out", { timeout: 30_000 });
    const body = await response.text();
    expect(response.status(), body).toBe(409);
  });

  test("manager payroll endpoint summarizes persisted time entries", async ({ page }) => {
    await loginViaUI(page);
    await setRole(page, "admin");

    const ensureClockIn = await page.request.post("/api/time-clock/clock-in", { timeout: 30_000 });
    expect([200, 409]).toContain(ensureClockIn.status());

    const payrollResponse = await page.request.get("/api/hours-payroll?range=week", { timeout: 30_000 });
    const payrollBody = await payrollResponse.text();
    expect(payrollResponse.status(), payrollBody).toBe(200);
    const payroll = JSON.parse(payrollBody)?.item ?? {};

    expect(typeof payroll.totalEstimatedPayroll).toBe("number");
    expect(typeof payroll.activeEmployees).toBe("number");
    expect(Array.isArray(payroll.employees)).toBe(true);
    expect(Array.isArray(payroll.entries)).toBe(true);
  });
});
