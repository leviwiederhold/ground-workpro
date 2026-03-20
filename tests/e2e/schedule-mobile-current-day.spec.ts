import { expect, test } from "@playwright/test";
import { loginViaUI } from "./helpers";

function asDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

test("mobile schedule opens with the current day already in view", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginViaUI(page);

  await page.goto("/");
  await page.getByLabel("Open sidebar").click();
  await page.getByTestId("nav-schedule").click();

  const strip = page.getByTestId("schedule-day-strip");
  const todayHeader = page.getByTestId(`schedule-day-header-${asDateKey(new Date())}`);

  await expect(strip).toBeVisible();
  await expect(todayHeader).toBeVisible();

  const stripBox = await strip.boundingBox();
  const todayBox = await todayHeader.boundingBox();

  expect(stripBox).toBeTruthy();
  expect(todayBox).toBeTruthy();
  expect(todayBox.x).toBeGreaterThanOrEqual(stripBox.x);
  expect(todayBox.x + todayBox.width).toBeLessThanOrEqual(stripBox.x + stripBox.width);
});
