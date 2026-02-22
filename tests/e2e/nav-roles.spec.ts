import { expect, test, type Page } from '@playwright/test';
import { loginViaUI } from './helpers';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3002';

type Role = 'admin' | 'pm' | 'foreman' | 'mechanic' | 'operator';

async function setRole(page: Page, role: Role) {
  const response = await page.request.post('/api/test/set-role', { data: { role } });
  const body = await response.text();
  expect(response.status(), body).toBe(200);

  const payload = JSON.parse(body);
  expect(payload?.success).toBe(true);

  await page.context().addCookies([
    { name: 'e2e_role', value: role, url: BASE_URL },
  ]);
}

test('role-scoped nav + guarded routes', async ({ page }) => {
  await loginViaUI(page);

  await setRole(page, 'operator');
  await page.goto('/');
  await expect(page.getByTestId('nav-jobs')).toHaveCount(0);

  const jobsForbidden = await page.request.get('/jobs');
  expect(jobsForbidden.status()).toBe(403);
  expect(await jobsForbidden.json()).toEqual({ error: 'Forbidden' });

  await setRole(page, 'mechanic');
  await page.goto('/');
  await expect(page.getByTestId('nav-maintenance')).toBeVisible();

  await setRole(page, 'foreman');
  const financeForbidden = await page.request.get('/finance');
  expect(financeForbidden.status()).toBe(403);
  expect(await financeForbidden.json()).toEqual({ error: 'Forbidden' });
});
