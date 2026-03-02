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

test("only admin can switch acting role", async ({ page }) => {
  await loginViaUI(page);

  await setRealRole(page, "operator");

  const navAsOperator = await page.request.get("/api/nav");
  const navAsOperatorJson = await navAsOperator.json();
  expect(navAsOperator.status()).toBe(200);
  expect(navAsOperatorJson?.canSwitchRoleView).toBe(false);

  const deniedSwitch = await page.request.post("/api/rbac/acting-role", {
    data: { role: "admin" },
  });
  const deniedSwitchBody = await deniedSwitch.text();
  expect(deniedSwitch.status(), deniedSwitchBody).toBe(403);
  expect(JSON.parse(deniedSwitchBody)).toEqual({ error: "Forbidden" });

  await page.goto("/");
  await expect(page.getByText("Executive / CEO")).toHaveCount(0);

  await setRealRole(page, "admin");

  const navAsAdmin = await page.request.get("/api/nav");
  const navAsAdminJson = await navAsAdmin.json();
  expect(navAsAdmin.status()).toBe(200);
  expect(navAsAdminJson?.canSwitchRoleView).toBe(true);

  const allowedSwitch = await page.request.post("/api/rbac/acting-role", {
    data: { role: "operator" },
  });
  const allowedSwitchBody = await allowedSwitch.text();
  expect(allowedSwitch.status(), allowedSwitchBody).toBe(200);
  expect(JSON.parse(allowedSwitchBody)?.item?.role).toBe("operator");
});
