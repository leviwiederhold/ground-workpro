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
  await page.evaluate(() => window.localStorage.setItem("app.currentView", "schedule"));
  await page.reload();

  const todayKey = asDateKey(new Date());
  const todayCell = page.getByTestId(`schedule-mobile-day-${todayKey}`);
  const agendaTitle = page.getByTestId(`schedule-mobile-agenda-title-${todayKey}`);

  await expect(todayCell).toBeVisible();
  await expect(agendaTitle).toBeVisible();
  await expect(todayCell).toHaveAttribute("aria-pressed", "true");
});
