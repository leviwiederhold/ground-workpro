import { test as setup } from '@playwright/test';
import { getE2ECreds } from './helpers';

const authFile = 'playwright/.auth/user.json';
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';

setup('authenticate', async ({ page }) => {
  const { email, password } = getE2ECreds();
  await page.goto('/login');

  const loginResponse = await page.request.post('/api/test/login', {
    data: { email, password },
  });
  const loginBody = await loginResponse.text();
  if (!loginResponse.ok()) {
    throw new Error(`E2E setup login failed: ${loginBody}`);
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
