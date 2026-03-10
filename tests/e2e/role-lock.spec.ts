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

test("only admin can switch acting role", async ({ page }) => {
  await loginViaUI(page);

  await setRealRole(page, "operator");

  const navAsOperator = await page.request.get("/api/nav", { timeout: 30_000 });
  const navAsOperatorJson = await navAsOperator.json();
  expect(navAsOperator.status()).toBe(200);
  expect(navAsOperatorJson?.canSwitchRoleView).toBe(false);

  const deniedSwitch = await page.request.post("/api/rbac/acting-role", {
    data: { role: "admin" },
    timeout: 30_000,
  });
  const deniedSwitchBody = await deniedSwitch.text();
  expect(deniedSwitch.status(), deniedSwitchBody).toBe(403);
  expect(JSON.parse(deniedSwitchBody)).toEqual({ error: "Forbidden" });

  await page.goto("/");
  await expect(page.getByText("Executive / CEO")).toHaveCount(0);

  await setRealRole(page, "admin");

  const navAsAdmin = await page.request.get("/api/nav", { timeout: 30_000 });
  const navAsAdminJson = await navAsAdmin.json();
  expect(navAsAdmin.status()).toBe(200);
  expect(navAsAdminJson?.canSwitchRoleView).toBe(true);

  const allowedSwitch = await page.request.post("/api/rbac/acting-role", {
    data: { role: "operator" },
    timeout: 30_000,
  });
  const allowedSwitchBody = await allowedSwitch.text();
  expect(allowedSwitch.status(), allowedSwitchBody).toBe(200);
  expect(JSON.parse(allowedSwitchBody)?.item?.role).toBe("operator");
});

test("CEO member role and permissions remain locked", async ({ page }) => {
  await loginViaUI(page);
  await setRealRole(page, "admin");

  const teamResponse = await page.request.get("/api/team?limit=50");
  const teamBody = await teamResponse.text();
  expect(teamResponse.status(), teamBody).toBe(200);
  const teamItems = JSON.parse(teamBody)?.items ?? [];
  const ceo = teamItems.find((item: { role?: string; accountStatus?: string }) => {
    const role = String(item?.role ?? "").toLowerCase();
    return role === "admin" && String(item?.accountStatus ?? "").toLowerCase() === "active";
  });
  expect(Boolean(ceo)).toBeTruthy();

  const roleChangeResponse = await page.request.patch(`/api/employees/${ceo.id}`, {
    data: { role: "pm" },
  });
  const roleChangeBody = await roleChangeResponse.text();
  expect(roleChangeResponse.status(), roleChangeBody).toBe(400);
  expect(JSON.parse(roleChangeBody)?.error).toContain("CEO role is locked");

  const permissionChangeResponse = await page.request.patch(`/api/team/members/${ceo.id}/permissions`, {
    data: {
      role: "manager",
      permissions: [{ module_key: "jobs", access_level: "view" }],
    },
  });
  const permissionChangeBody = await permissionChangeResponse.text();
  expect(permissionChangeResponse.status(), permissionChangeBody).toBe(400);
  expect(JSON.parse(permissionChangeBody)?.error).toContain("CEO role is locked");
});
