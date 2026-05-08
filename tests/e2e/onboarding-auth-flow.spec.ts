import { expect, test } from "@playwright/test";
import { getE2ECreds } from "./helpers";

test("native onboarding exposes existing account login with app typography", async ({ browser, baseURL }) => {
  const { email, password } = getE2ECreds();
  const context = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  });
  await context.addInitScript(() => {
    Object.defineProperty(window, "Capacitor", {
      value: {
        isNativePlatform: () => true,
        getPlatform: () => "ios",
      },
      configurable: true,
    });
  });
  const page = await context.newPage();

  await page.goto("/");
  await page.getByRole("button", { name: "Skip" }).click();

  const titleFont = await page.locator(".logo-text").evaluate((element) => {
    return window.getComputedStyle(element).fontFamily;
  });
  expect(titleFont.toLowerCase()).toContain("dozer");

  await page.getByTestId("onboarding-existing-login").click();
  await expect(page.getByText("Sign in to Groundwork Pro")).toBeVisible();
  await page.getByTestId("onboarding-login-email").fill(email);
  await page.getByTestId("onboarding-login-password").fill(password);
  await page.getByTestId("onboarding-auth-submit").click();

  await expect(page.getByTestId("dashboard-header")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".gw-onboarding")).toHaveCount(0);

  await context.close();
});

test("native onboarding keeps invite flow separate from existing login", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  });
  await context.addInitScript(() => {
    Object.defineProperty(window, "Capacitor", {
      value: {
        isNativePlatform: () => true,
        getPlatform: () => "ios",
      },
      configurable: true,
    });
  });
  const page = await context.newPage();

  await page.goto("/");
  await page.getByRole("button", { name: "Skip" }).click();
  await page.getByRole("button", { name: /I'm an employee/i }).click();

  await expect(page.getByText("Join your team")).toBeVisible();
  await expect(page.getByText("Invite code or link", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Already have an account? Sign In" }).click();
  await expect(page.getByText("Sign in to Groundwork Pro")).toBeVisible();
  await expect(page.getByText("Use your existing employee or company account.")).toBeVisible();

  await context.close();
});
