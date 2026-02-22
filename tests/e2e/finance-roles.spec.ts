import { expect, test, type Page } from '@playwright/test';

type Role = 'admin' | 'pm' | 'foreman' | 'mechanic' | 'operator';
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';

async function setRole(page: Page, role: Role) {
  let response = await page.request.post('/api/test/set-role', { data: { role } });
  let body = await response.text();

  if (response.status() === 403 && body.includes('No company membership found')) {
    const bootstrap = await page.request.post('/api/bootstrap');
    const bootstrapBody = await bootstrap.text();
    expect([200, 400]).toContain(bootstrap.status());
    if (bootstrap.status() === 400 && !bootstrapBody.toLowerCase().includes('duplicate')) {
      throw new Error(bootstrapBody);
    }
    response = await page.request.post('/api/test/set-role', { data: { role } });
    body = await response.text();
  }

  expect(response.status(), body).toBe(200);

  await page.context().addCookies([
    {
      name: 'e2e_role',
      value: role,
      url: BASE_URL,
    },
  ]);
}

test('finance role gating + deterministic placeholder UI', async ({ page }) => {
  await setRole(page, 'admin');
  await page.goto('/');
  await expect(page.getByTestId('nav-finance')).toBeVisible();
  await page.getByTestId('nav-finance').click();
  await expect(page.getByText('Accounting Integration')).toBeVisible();
  await expect(page.getByText('Not configured yet').first()).toBeVisible();

  await setRole(page, 'pm');
  await page.goto('/');
  await expect(page.getByTestId('nav-finance')).toBeVisible();

  await setRole(page, 'foreman');
  await page.goto('/');
  await expect(page.getByTestId('nav-finance')).toHaveCount(0);
  const foremanRoute = await page.request.get('/finance');
  expect(foremanRoute.status()).toBe(403);
  expect(await foremanRoute.json()).toEqual({ error: 'Forbidden' });

  await setRole(page, 'mechanic');
  await page.goto('/');
  await expect(page.getByTestId('nav-finance')).toHaveCount(0);
  const mechanicRoute = await page.request.get('/finance');
  expect(mechanicRoute.status()).toBe(403);
  expect(await mechanicRoute.json()).toEqual({ error: 'Forbidden' });

  await setRole(page, 'operator');
  await page.goto('/');
  await expect(page.getByTestId('nav-finance')).toHaveCount(0);
  const operatorRoute = await page.request.get('/finance');
  expect(operatorRoute.status()).toBe(403);
  expect(await operatorRoute.json()).toEqual({ error: 'Forbidden' });
});
