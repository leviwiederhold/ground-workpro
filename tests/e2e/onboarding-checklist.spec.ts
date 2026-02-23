import { expect, test, type Page } from '@playwright/test';
import { loginViaUI } from './helpers';

type Role = 'admin' | 'pm' | 'foreman' | 'mechanic' | 'operator';
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3002';

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

test('onboarding checklist is role-aware and persisted', async ({ page }) => {
  await loginViaUI(page);

  await setRole(page, 'admin');

  await page.goto('/');
  await page.getByTestId('nav-dashboard').click();
  await expect(page.getByRole('heading', { name: 'Getting Started' })).toBeVisible();

  await expect(page.getByTestId('onboarding-item-invite_teammate')).toBeVisible();
  await expect(page.getByTestId('onboarding-item-create_first_job')).toBeVisible();
  await expect(page.getByTestId('onboarding-item-create_first_bid')).toBeVisible();
  await expect(page.getByTestId('onboarding-item-send_first_proposal')).toBeVisible();
  await expect(page.getByTestId('onboarding-item-add_first_equipment')).toBeVisible();

  const completeRes = await page.request.post('/api/onboarding/checklist/complete', {
    data: { key: 'invite_teammate', completed: true },
  });
  const completeBody = await completeRes.text();
  expect(completeRes.status(), completeBody).toBe(200);

  await page.reload();
  await page.getByTestId('nav-dashboard').click();

  const summaryResponse = await page.request.get('/api/dashboard/summary');
  expect(summaryResponse.status(), await summaryResponse.text()).toBe(200);
  const summary = await summaryResponse.json();
  const checklistItems = summary?.item?.sections?.gettingStarted?.items ?? [];
  const invited = checklistItems.find((entry: { key: string }) => entry.key === 'invite_teammate');
  expect(invited?.completed).toBe(true);
});
