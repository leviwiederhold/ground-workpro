import { expect, type Page } from '@playwright/test';

export const E2E_BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';

export function getE2ECreds() {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;

  if (!email || !password || email === '...' || password === '...') {
    throw new Error(
      'Invalid E2E_EMAIL or E2E_PASSWORD. Use real login credentials (not "...") before running e2e tests.'
    );
  }

  return { email, password };
}

export async function loginViaUI(page: Page) {
  const { email, password } = getE2ECreds();
  const navJobs = page.getByTestId('nav-jobs');

  await page.goto('/');
  if (await navJobs.isVisible().catch(() => false)) {
    return;
  }

  await page.goto('/login');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);

  await Promise.all([
    page.waitForURL(/\/$/, { timeout: 30_000 }),
    page.getByTestId('login-submit').click(),
  ]).catch(async () => {
    const loginError = page.getByTestId('login-error');
    if (await loginError.isVisible().catch(() => false)) {
      const message = (await loginError.textContent())?.trim() || 'Unknown login error';
      throw new Error(`E2E login failed: ${message}`);
    }
    throw new Error('E2E login failed: app did not navigate after submit.');
  });

  await expect(navJobs).toBeVisible({ timeout: 30_000 });
}
