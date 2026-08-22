import { expect, test } from '@playwright/test';

test.describe('native App Store auth compliance', () => {
  test.use({
    viewport: { width: 1024, height: 1366 },
    isMobile: true,
    hasTouch: true,
  });

  test('iPad native login does not link to direct company signup', async ({ page }) => {
    await page.goto('/login?gw_native=1');

    await expect(page.getByRole('heading', { name: 'Welcome to Groundwork Pro' })).toBeVisible();
    await expect(page.getByTestId('login-submit')).toBeVisible();
    await expect(page.getByText('Already part of a company? Sign in')).toBeVisible();
    await expect(page.getByText('Need access? Join with your company code or contact your company administrator.')).toBeVisible();
    await expect(page.getByRole('link', { name: /sign up/i })).toHaveCount(0);
  });

  test('fresh native iPad onboarding keeps login and company-code join but no company signup', async ({ page }) => {
    await page.request.post('/api/logout');
    await page.context().clearCookies();
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });

    await page.goto('/?gw_native=1');
    await page.getByRole('button', { name: 'Skip' }).click();

    await expect(page.getByRole('button', { name: /Already part of a company/ })).toBeVisible();
    await expect(page.getByText('Sign in with your company account. New company signup is available on the web.')).toBeVisible();
    await expect(page.getByRole('button', { name: /I'm an employee/ })).toBeVisible();
    await expect(page.getByTestId('onboarding-existing-login')).toBeVisible();
    await expect(page.getByText('Create your company')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /create account/i })).toHaveCount(0);

    await page.getByRole('button', { name: /Already part of a company/ }).click();
    await expect(page.getByText('Contact your company administrator', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Sign in$/ })).toBeVisible();
  });

  test('iPad native signup is invite-only', async ({ page }) => {
    await page.goto('/signup?gw_native=1');

    await expect(page.getByRole('heading', { name: 'Already part of a company?' })).toBeVisible();
    await expect(page.getByText('Contact your company administrator', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /create account/i })).toHaveCount(0);
    await expect(page.locator('input[type="email"]')).toHaveCount(0);

    await page.goto('/signup?gw_native=1&invite=1&token=test-token');
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /create account/i })).toBeVisible();
  });

  test('web signup still allows direct account creation UI', async ({ page }) => {
    await page.goto('/signup');

    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /create account/i })).toBeVisible();
    await expect(page.getByText('Contact your company administrator')).toHaveCount(0);
  });
});
