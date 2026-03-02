import { expect, test, type Page } from "@playwright/test";
import { loginViaUI } from "./helpers";

type Role = "admin" | "pm" | "foreman" | "mechanic" | "operator";

async function setRealRole(page: Page, role: Role) {
  let response = await page.request.post("/api/test/set-role", { data: { role } });
  let body = await response.text();

  if (response.status() === 403 && body.includes("No company membership found")) {
    const bootstrap = await page.request.post("/api/bootstrap");
    const bootstrapBody = await bootstrap.text();
    expect([200, 400]).toContain(bootstrap.status());
    if (bootstrap.status() === 400 && !bootstrapBody.toLowerCase().includes("duplicate")) {
      throw new Error(bootstrapBody);
    }
    response = await page.request.post("/api/test/set-role", { data: { role } });
    body = await response.text();
  }

  expect(response.status(), body).toBe(200);
}

async function expectForbidden(page: Page, route: string) {
  const response = await page.request.get(route);
  const body = await response.text();
  expect(response.status(), `${route}: ${body}`).toBe(403);
  expect(JSON.parse(body)).toEqual({ error: "Forbidden" });
}

test("nav and route guards follow role matrix", async ({ page }) => {
  await loginViaUI(page);

  await setRealRole(page, "admin");
  const adminNavResponse = await page.request.get("/api/nav");
  const adminNavJson = await adminNavResponse.json();
  expect(adminNavResponse.status()).toBe(200);
  expect((adminNavJson?.items ?? []).some((item: { key?: string }) => item.key === "jobs")).toBeTruthy();
  expect((adminNavJson?.items ?? []).some((item: { key?: string }) => item.key === "finance")).toBeTruthy();

  await setRealRole(page, "operator");
  const operatorNavResponse = await page.request.get("/api/nav");
  const operatorNavJson = await operatorNavResponse.json();
  expect(operatorNavResponse.status()).toBe(200);
  expect((operatorNavJson?.items ?? []).some((item: { key?: string }) => item.key === "jobs")).toBeFalsy();
  expect((operatorNavJson?.items ?? []).some((item: { key?: string }) => item.key === "finance")).toBeFalsy();
  await expectForbidden(page, "/jobs");
  await expectForbidden(page, "/finance");
  await expectForbidden(page, "/vendors");
  await expectForbidden(page, "/integrations");

  await setRealRole(page, "mechanic");
  const mechanicNavResponse = await page.request.get("/api/nav");
  const mechanicNavJson = await mechanicNavResponse.json();
  expect(mechanicNavResponse.status()).toBe(200);
  expect((mechanicNavJson?.items ?? []).some((item: { key?: string }) => item.key === "maintenance")).toBeTruthy();
  expect((mechanicNavJson?.items ?? []).some((item: { key?: string }) => item.key === "jobs")).toBeFalsy();
  await expectForbidden(page, "/jobs");
  await expectForbidden(page, "/finance");

  await setRealRole(page, "foreman");
  const foremanNavResponse = await page.request.get("/api/nav");
  const foremanNavJson = await foremanNavResponse.json();
  expect(foremanNavResponse.status()).toBe(200);
  expect((foremanNavJson?.items ?? []).some((item: { key?: string }) => item.key === "jobs")).toBeTruthy();
  expect((foremanNavJson?.items ?? []).some((item: { key?: string }) => item.key === "finance")).toBeFalsy();
  await expectForbidden(page, "/finance");
});
