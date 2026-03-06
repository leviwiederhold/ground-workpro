import { test as setup } from '@playwright/test';
import { E2E_BASE_URL, getE2ECreds } from './helpers';

const authFile = 'playwright/.auth/user.json';
const BASE_URL = process.env.E2E_BASE_URL || E2E_BASE_URL;

setup('authenticate', async ({ page }) => {
  const { email, password } = getE2ECreds();
  const apiLogin = await page.request.post('/api/test/login', {
    data: { email, password },
    timeout: 30000,
  });

  if (!apiLogin.ok()) {
    await page.goto('/login');
    await page.getByTestId('login-email').fill(email);
    await page.getByTestId('login-password').fill(password);
    await page.getByTestId('login-submit').click();
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 });
  } else {
    await page.goto('/');
  }

  const bootstrapResponse = await page.request.post('/api/bootstrap');
  const bootstrapBody = await bootstrapResponse.text();
  if (![200, 400].includes(bootstrapResponse.status())) {
    throw new Error(`E2E setup bootstrap failed: ${bootstrapBody}`);
  }

  let roleResetResponse = await page.request.post('/api/test/set-role', {
    data: { role: 'admin' },
    timeout: 30000,
  });
  if (!roleResetResponse.ok() && roleResetResponse.status() !== 404) {
    roleResetResponse = await page.request.post('/api/test/set-role', {
      data: { role: 'admin' },
      timeout: 30000,
    });
  }
  const roleResetBody = await roleResetResponse.text();
  if (![200, 404].includes(roleResetResponse.status())) {
    throw new Error(`E2E setup role reset failed: ${roleResetBody}`);
  }

  await page.context().addCookies([
    { name: 'e2e_role', value: 'admin', url: BASE_URL, sameSite: 'Lax' },
    { name: 'gw_acting_role', value: 'admin', url: BASE_URL, sameSite: 'Lax' },
  ]);

  await page.context().storageState({ path: authFile });
});
