import { expect, test, type APIRequestContext } from "@playwright/test";
import { loginViaUI } from "./helpers";

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
});
