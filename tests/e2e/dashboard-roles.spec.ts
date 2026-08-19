import { expect, test, type Page } from '@playwright/test';
import { loginViaUI } from './helpers';

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
}

test('admin dashboard keeps CEO cards and weather', async ({ page }) => {
  await loginViaUI(page);
  await setRole(page, 'admin');
  await openDashboard(page);

  await expect(page.getByText('Month Revenue')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Active Jobs' })).toBeVisible();
  await expect(page.getByText('Weather - Cincinnati')).toBeVisible();
});

test('operator dashboard shows assignment and weather', async ({ page }) => {
  await loginViaUI(page);
  await setRole(page, 'operator');
  await openDashboard(page);

  await expect(page.getByRole('heading', { name: 'My assignment today' })).toBeVisible();
  await expect(page.getByText('Weather - Cincinnati')).toBeVisible();
});

test('mechanic dashboard shows open work orders and weather', async ({ page }) => {
  await loginViaUI(page);
  await setRole(page, 'mechanic');
  await openDashboard(page);

  await expect(page.getByTestId('stat-card-open_work_orders')).toBeVisible();
  await expect(page.getByText('Weather - Cincinnati')).toBeVisible();
});

test('no role gets a manual time clock quick action', async ({ page }) => {
  await loginViaUI(page);

  for (const role of ['admin', 'pm', 'foreman', 'mechanic', 'operator'] as Role[]) {
    await setRole(page, role);
    const response = await page.request.get('/api/dashboard', { timeout: 30_000 });
    const body = await response.text();
    expect(response.status(), body).toBe(200);
    const primaryItems = JSON.parse(body)?.item?.sections?.primary?.items ?? [];
    const quickActions = primaryItems.find((item: { type?: string }) => item.type === 'quick_actions')?.meta?.items ?? [];
    const keys = quickActions.map((action: { key?: string }) => String(action.key ?? ''));
    expect(keys).not.toContain('time_clock');
    expect(keys.length).toBeGreaterThan(1);
  }
});
