import { expect, Page } from '@playwright/test';

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
  await page.getByTestId('login-submit').click();
  const loginError = page.getByTestId('login-error');
  const loginSubmit = page.getByTestId('login-submit');

  await expect
    .poll(
      async () => {
        if (await navJobs.isVisible().catch(() => false)) return 'success';
        if (await loginError.isVisible().catch(() => false)) return 'error';
        const submitText = (await loginSubmit.textContent().catch(() => ''))?.trim();
        if (submitText !== 'Signing in...') return 'stalled';
        return 'pending';
      },
      { timeout: 30_000 }
    )
    .not.toBe('pending');

  if (await loginError.isVisible().catch(() => false)) {
    const message = (await loginError.textContent())?.trim() || 'Unknown login error';
    throw new Error(`E2E login failed: ${message}`);
  }

  if (!(await navJobs.isVisible().catch(() => false))) {
    throw new Error('E2E login failed: submit completed but app did not navigate to authenticated shell.');
  }

  await expect(navJobs).toBeVisible();
}
