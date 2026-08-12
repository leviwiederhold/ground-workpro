import { expect, test, type Page } from "@playwright/test";
import { loginViaUI } from "./helpers";

async function setRoleAdmin(page: Page) {
  const response = await page.request.post("/api/test/set-role", { data: { role: "admin" } });
  const body = await response.text();
  expect(response.status(), body).toBe(200);
}

test("Team uses only canonical access-role terminology", async ({ page }) => {
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
  await setRoleAdmin(page);
  await page.goto("/team");

  await expect(page.getByRole("status", { name: "Loading" })).toHaveCount(0, { timeout: 20_000 });
  await page.getByRole("button", { name: "Add Team Member" }).click();
  const dialog = page.locator(".mobile-sheet-panel").filter({ hasText: "Invite Team Member" });
  await expect(dialog.getByText("Invite Team Member")).toBeVisible();

  const roleSelect = dialog.locator("select").first();
  await expect(roleSelect.locator("option")).toHaveText([
    "Owner",
    "Administrator",
    "Manager",
    "Crew Lead",
    "Team Member",
  ]);

  await expect(dialog.getByText(/CEO|Co-CEO|Operations Manager|Foreman|Mechanic|Field Staff/)).toHaveCount(0);
});
