import { expect, test } from "@playwright/test";
import { loginViaUI } from "./helpers";

test("integrations page stays visible but blocked with coming soon treatment", async ({ page }) => {
  await loginViaUI(page);

  await page.goto("/");
  await page.getByTestId("nav-integrations").click();
  await expect(page.getByText("Integrations are staged for the beta roadmap.")).toBeVisible();
  await expect(page.getByText("This page is intentionally non-interactive for beta.")).toBeVisible();
  await expect(page.getByText("QuickBooks", { exact: true })).toBeVisible();
  await expect(page.getByText("blocked").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /connect/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /disconnect/i })).toHaveCount(0);
});
