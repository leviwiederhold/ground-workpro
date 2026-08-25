import { expect, test, type Page } from "@playwright/test";
import { loginViaUI } from "./helpers";

type Role = "admin" | "pm" | "foreman" | "mechanic" | "operator";

async function setRealRole(page: Page, role: Role) {
  let response = await page.request.post("/api/test/set-role", { data: { role }, timeout: 30_000 });
  let body = await response.text();

  if (response.status() === 403 && body.includes("No company membership found")) {
    const bootstrap = await page.request.post("/api/bootstrap", { timeout: 30_000 });
    const bootstrapBody = await bootstrap.text();
    expect([200, 400]).toContain(bootstrap.status());
    if (bootstrap.status() === 400 && !bootstrapBody.toLowerCase().includes("duplicate")) {
      throw new Error(bootstrapBody);
    }
    response = await page.request.post("/api/test/set-role", { data: { role }, timeout: 30_000 });
    body = await response.text();
  }

  expect(response.status(), body).toBe(200);
}

test("only the real Owner can restore an Owner acting view", async ({ page }) => {
  await loginViaUI(page);

  await setRealRole(page, "operator");

  const navAsOperator = await page.request.get("/api/nav", { timeout: 30_000 });
  const navAsOperatorJson = await navAsOperator.json();
  expect(navAsOperator.status()).toBe(200);
  expect(navAsOperatorJson?.canSwitchRoleView).toBe(false);

  await page.goto("/");
  await expect(page.getByText("Owner")).toHaveCount(0);

  const ownerSwitch = await page.request.post("/api/rbac/acting-role", {
    data: { role: "admin" },
    timeout: 30_000,
  });
  const ownerSwitchBody = await ownerSwitch.text();
  expect(ownerSwitch.status(), ownerSwitchBody).toBe(200);
  expect(JSON.parse(ownerSwitchBody)?.item?.role).toBe("admin");

  await setRealRole(page, "admin");

  const navAsAdmin = await page.request.get("/api/nav", { timeout: 30_000 });
  const navAsAdminJson = await navAsAdmin.json();
  expect(navAsAdmin.status()).toBe(200);
  expect(navAsAdminJson?.role).toBe("admin");

  const allowedSwitch = await page.request.post("/api/rbac/acting-role", {
    data: { role: "operator" },
    timeout: 30_000,
  });
  const allowedSwitchBody = await allowedSwitch.text();
  expect(allowedSwitch.status(), allowedSwitchBody).toBe(200);
  expect(JSON.parse(allowedSwitchBody)?.item?.role).toBe("operator");
});

test("Owner member role and permissions remain locked", async ({ page }) => {
  await page.route("**/api/onboarding/setup-status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        item: { role: "admin", has_company: true, required_complete: true, is_complete: true },
      }),
    });
  });
  await loginViaUI(page);
  page.removeAllListeners("console");
  await setRealRole(page, "admin");

  const teamResponse = await page.request.get("/api/team?limit=50");
  const teamBody = await teamResponse.text();
  expect(teamResponse.status(), teamBody).toBe(200);
  const teamItems = JSON.parse(teamBody)?.items ?? [];
  const owner = teamItems.find((item: { role?: string; accountStatus?: string }) => {
    const role = String(item?.role ?? "").toLowerCase();
    return role === "owner" && String(item?.accountStatus ?? "").toLowerCase() === "active";
  });
  expect(Boolean(owner)).toBeTruthy();

  expect(String(owner.recordSource)).toMatch(/^(employee|membership)$/);

  await page.goto("/team");
  await page.getByRole("heading", { name: String(owner.displayName), exact: true }).last().click();
  await expect(page.getByText("Primary owner role is locked.", { exact: true })).toBeVisible();
});

test("normal Team role APIs cannot assign primary Owner", async ({ page }) => {
  await loginViaUI(page);
  await setRealRole(page, "pm");

  const permissionResponse = await page.request.post("/api/test/module-permissions", {
    data: {
      permissions: [{ module_key: "team_management", access_level: "edit" }],
    },
  });
  expect(permissionResponse.status(), await permissionResponse.text()).toBe(200);

  const inviteResponse = await page.request.post("/api/team/invitations", {
    data: { role: "owner" },
  });
  const inviteBody = await inviteResponse.text();
  expect(inviteResponse.status(), inviteBody).toBe(400);
  expect(JSON.parse(inviteBody)?.error).toContain("ownership");
});
