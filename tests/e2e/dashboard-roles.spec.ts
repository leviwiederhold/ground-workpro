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

async function openDashboard(page: Page) {
  await page.goto('/');
  await page.getByTestId('nav-dashboard').click();
  await expect(page.getByRole('heading', { name: 'Quick Actions' })).toBeVisible();
}

test('dashboard summary visibility is role scoped', async ({ page }) => {
  await setRole(page, 'admin');
  await openDashboard(page);
  await expect(page.getByText('Month Revenue')).toBeVisible();

  await setRole(page, 'foreman');
  await openDashboard(page);
  await expect(page.getByText('Month Revenue')).toHaveCount(0);
  await expect(page.getByText('Fleet Utilization')).toHaveCount(0);

  await setRole(page, 'mechanic');
  await openDashboard(page);
  await expect(page.getByRole('heading', { name: 'Open Work Orders' })).toBeVisible();

  await setRole(page, 'operator');
  await openDashboard(page);
  await expect(page.getByText('Month Revenue')).toHaveCount(0);
});
