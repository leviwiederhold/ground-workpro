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
  await page.context().addCookies([{ name: 'e2e_role', value: role, url: BASE_URL }]);
}

async function readStatNumber(page: Page, key: string) {
  const valueText = await page.getByTestId(`stat-card-${key}`).locator('p').first().innerText();
  const digits = Number.parseInt(valueText.replace(/[^\d-]/g, ''), 10);
  return Number.isNaN(digits) ? 0 : digits;
}

test('dashboard stat cards are live and drill down to owner pages', async ({ page }) => {
  await setRole(page, 'admin');

  await page.goto('/');
  await page.getByTestId('nav-dashboard').click();

  const before = await readStatNumber(page, 'active_jobs');

  const createResponse = await page.request.post('/api/jobs', {
    data: {
      name: `E2E Live Stat Job ${Date.now()}`,
      status: 'in_progress',
      site_address: '123 Test Lane',
      notes: 'created by stat-cards-live e2e',
    },
  });
  const createBody = await createResponse.text();
  expect(createResponse.status(), createBody).toBe(201);

  await page.reload();
  const after = await readStatNumber(page, 'active_jobs');
  expect(after).toBeGreaterThanOrEqual(before + 1);

  await page.getByTestId('stat-card-active_jobs').click();
  await expect(page.getByPlaceholder('Search jobs...')).toBeVisible();
});

test('operator sees only allowed dashboard stats with restricted stats hidden', async ({ page }) => {
  await setRole(page, 'operator');
  await page.goto('/');
  await page.getByTestId('nav-dashboard').click();

  await expect(page.getByTestId('stat-card-my_jobs_today')).toBeVisible();
  await expect(page.getByTestId('stat-card-month_revenue')).toHaveCount(0);
  await expect(page.getByText('Month Revenue')).toHaveCount(0);

  await page.getByTestId('stat-card-unread_messages').click();
  await expect(page.getByPlaceholder('Search channels...')).toBeVisible();
});
