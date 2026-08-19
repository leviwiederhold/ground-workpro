import { expect, test } from "@playwright/test";
import { loginViaUI } from "./helpers";

test("Dashboard follows live dark and light appearance changes", async ({ page }) => {
  await loginViaUI(page);
  await page.goto("/");

  const dashboard = page.getByTestId("dashboard-view");
  await expect(dashboard).toBeVisible({ timeout: 20_000 });

  await page.evaluate(() => {
    window.localStorage.setItem("groundwork.appearance", "dark");
    window.dispatchEvent(new CustomEvent("appearance:change", { detail: "dark" }));
  });

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect
    .poll(() => dashboard.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe("rgb(5, 5, 5)");

  const firstDashboardCard = page.getByTestId("stats-grid").locator(":scope > *").first();
  await expect(firstDashboardCard).toBeVisible();
  await expect
    .poll(() => firstDashboardCard.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe("rgb(15, 15, 16)");

  await page.evaluate(() => {
    window.localStorage.setItem("groundwork.appearance", "light");
    window.dispatchEvent(new CustomEvent("appearance:change", { detail: "light" }));
  });

  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect
    .poll(() => dashboard.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe("rgb(249, 250, 251)");
});

test("Equipment keeps its existing route and manual clock controls are absent", async ({ page }) => {
  await loginViaUI(page);
  await page.goto("/");

  await page.getByTestId("nav-fleet").click();
  await expect(page).toHaveURL(/\/fleet$/);
  await expect(page.getByRole("heading", { name: "Equipment", exact: true })).toBeVisible();

  await page.goto("/");
  await expect(page.getByTestId("quick-action-time_clock")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(Clock In|Clock Out|Time Clock)$/i })).toHaveCount(0);

  await page.goto("/jobsite-time");
  await expect(page.getByText(/manual clock-in fallback/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(Clock In|Clock Out|Time Clock)$/i })).toHaveCount(0);
});
