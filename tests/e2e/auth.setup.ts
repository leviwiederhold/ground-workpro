import { test as setup } from '@playwright/test';
import { E2E_BASE_URL, getE2ECreds, loginViaUI } from './helpers';

const authFile = 'playwright/.auth/user.json';
const BASE_URL = process.env.E2E_BASE_URL || E2E_BASE_URL;

setup('authenticate', async ({ page }) => {
  const { email, password } = getE2ECreds();
  const apiLogin = await page.request.post('/api/test/login', {
    data: { email, password },
    timeout: 30000,
  });

  if (!apiLogin.ok()) {
    await loginViaUI(page);
  } else {
    await page.goto('/login');
  }

  const bootstrapResponse = await page.request.post('/api/bootstrap');
  const bootstrapStatus = bootstrapResponse.status();
  if (![200, 400, 401, 403].includes(bootstrapStatus)) {
    const bootstrapBody = await bootstrapResponse.text();
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
  const roleResetStatus = roleResetResponse.status();
  const roleResetIsDevChunkFlake =
    roleResetStatus === 500 &&
    roleResetBody.includes('Cannot find module') &&
    roleResetBody.includes('.next/server/webpack-runtime.js');
  if (![200, 401, 403, 404].includes(roleResetStatus) && !roleResetIsDevChunkFlake) {
    throw new Error(`E2E setup role reset failed: ${roleResetBody}`);
  }

  await page.context().addCookies([
    { name: 'e2e_role', value: 'admin', url: BASE_URL, sameSite: 'Lax' },
    { name: 'gw_acting_role', value: 'admin', url: BASE_URL, sameSite: 'Lax' },
  ]);

  await page.context().storageState({ path: authFile });
});
