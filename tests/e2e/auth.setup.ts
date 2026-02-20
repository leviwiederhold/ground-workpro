import { test as setup } from '@playwright/test';
import { loginViaUI } from './helpers';

const authFile = 'playwright/.auth/user.json';

setup('authenticate', async ({ page }) => {
  await loginViaUI(page);
  await page.context().storageState({ path: authFile });
});
