import { expect, test } from "@playwright/test";
import { loginViaUI } from "./helpers";

test("integrations is hidden from primary navigation", async ({ page }) => {
  await loginViaUI(page);

  await page.goto("/");
  await expect(page.getByTestId("nav-integrations")).toHaveCount(0);
});
