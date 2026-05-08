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

test("messages mobile uses full-screen list to thread flow without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginViaUI(page);

  await page.goto("/");
  await page.getByLabel("Open sidebar").click();
  await page.getByTestId("nav-messages").click();

  const root = page.getByTestId("messages-root");
  await expect(root).toBeVisible();
  await expect(page.getByTestId("messages-sidebar")).toBeVisible();

  const initialMetrics = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="messages-root"]');
    if (!root) throw new Error("Messages root is missing");
    const rect = root.getBoundingClientRect();
    return {
      rootHeight: Math.round(rect.height),
      viewportHeight: Math.round(window.visualViewport?.height ?? window.innerHeight),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });
  expect(initialMetrics.rootHeight).toBeLessThanOrEqual(initialMetrics.viewportHeight);
  expect(initialMetrics.horizontalOverflow).toBeFalsy();

  const firstContact = page.locator('[data-testid^="messages-contact-"]').first();
  if (!(await firstContact.isVisible().catch(() => false))) {
    test.skip(true, "No visible message contact available");
  }

  await firstContact.click();
  await expect(page.getByTestId("messages-sidebar")).toBeHidden();
  await expect(page.getByTestId("messages-thread")).toBeVisible();
  await expect(page.getByTestId("messages-input")).toBeVisible();

  const threadMetrics = await page.evaluate(() => ({
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }));
  expect(threadMetrics.horizontalOverflow).toBeFalsy();
});
