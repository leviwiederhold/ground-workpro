import { expect, test, type Page } from '@playwright/test';
import { loginViaUI } from './helpers';

async function forceAdminRole(page: Page) {
  let response = await page.request.post('/api/test/set-role', { data: { role: 'admin' } });
  let body = await response.text();
  if (response.status() === 403 && body.includes('No company membership found')) {
    await page.request.post('/api/bootstrap');
    response = await page.request.post('/api/test/set-role', { data: { role: 'admin' } });
    body = await response.text();
  }
  expect(response.status(), body).toBe(200);
}

test('jobs create/list persists across refresh (api contract)', async ({ page }) => {
  await loginViaUI(page);
  await forceAdminRole(page);

  const createRes = await page.request.post('/api/jobs', {
    data: {
      name: `e2e-job-${Date.now()}`,
      status: 'in_progress',
      site_address: '123 Test St',
    },
  });
  const createBody = await createRes.text();
  expect(createRes.status(), createBody).toBe(200);
  const created = JSON.parse(createBody)?.job;
  const createdId = String(created?.id ?? '');
  expect(createdId).toBeTruthy();

  const listRes = await page.request.get('/api/jobs?status=all');
  expect(listRes.status()).toBe(200);
  const listJson = await listRes.json();
  const rows = Array.isArray(listJson?.items) ? listJson.items : [];
  expect(rows.some((row: { id: string }) => String(row.id) === createdId)).toBeTruthy();

  await page.reload();

  const listAfterRes = await page.request.get('/api/jobs?status=all');
  expect(listAfterRes.status()).toBe(200);
  const listAfterJson = await listAfterRes.json();
  const rowsAfter = Array.isArray(listAfterJson?.items) ? listAfterJson.items : [];
  expect(rowsAfter.some((row: { id: string }) => String(row.id) === createdId)).toBeTruthy();
});
