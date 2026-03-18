import { expect, test } from "@playwright/test";
import { loginViaUI } from "./helpers";

test("messages team members list fills the available sidebar height before scrolling", async ({ page }) => {
  await loginViaUI(page);

  await page.goto("/");
  await page.getByTestId("nav-messages").click();
  const list = page.getByTestId("messages-team-members-list");
  await expect(list).toBeVisible();

  const clientHeight = await list.evaluate((node) => node.clientHeight);
  expect(clientHeight).toBeGreaterThan(220);
});
