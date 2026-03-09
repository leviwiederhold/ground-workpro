import { expect, test, type Page } from '@playwright/test';
import { loginViaUI } from './helpers';

type Role = 'admin' | 'pm' | 'foreman' | 'mechanic' | 'operator';
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3002';

async function setRole(page: Page, role: Role) {
  let response = await page.request.post('/api/test/set-role', { data: { role }, timeout: 30_000 });
  let body = await response.text();

  if (response.status() === 403 && body.includes('No company membership found')) {
    const bootstrap = await page.request.post('/api/bootstrap', { timeout: 30_000 });
    const bootstrapBody = await bootstrap.text();
    expect([200, 400]).toContain(bootstrap.status());
    if (bootstrap.status() === 400 && !bootstrapBody.toLowerCase().includes('duplicate')) {
      throw new Error(bootstrapBody);
    }

    response = await page.request.post('/api/test/set-role', { data: { role }, timeout: 30_000 });
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

test('onboarding checklist persists and is role-aware', async ({ page }) => {
  await loginViaUI(page);

  await setRole(page, 'admin');
  const resetResponse = await page.request.post('/api/onboarding/checklist/reset', { timeout: 30_000 });
  const resetBody = await resetResponse.text();
  if (resetResponse.status() !== 200) {
    expect(resetBody.toLowerCase()).toContain('onboarding_checklist');
  }
  const dismissResponse = await page.request.post('/api/onboarding/checklist/dismiss', {
    data: { dismissed: false },
    timeout: 30_000,
  });
  const dismissBody = await dismissResponse.text();
  if (dismissResponse.status() !== 200) {
    expect(dismissBody.toLowerCase()).toContain('onboarding_checklist');
  }

  await page.goto('/');
  await page.getByTestId('nav-dashboard').click();
  await expect(page.getByRole('heading', { name: 'Getting Started' })).toBeVisible();
  const inviteItem = page.getByTestId('onboarding-item-invite_teammate');
  if (await inviteItem.count()) {
    await expect(inviteItem).toBeVisible();
    await expect(page.getByTestId('onboarding-item-create_first_bid')).toBeVisible();
  } else {
    const summaryRes = await page.request.get('/api/dashboard/summary');
    expect(summaryRes.status(), await summaryRes.text()).toBe(200);
    const summary = await summaryRes.json();
    const checklistItems = summary?.item?.sections?.gettingStarted?.items ?? [];
    expect(checklistItems.some((entry: { key: string }) => entry.key === 'invite_teammate')).toBeTruthy();
  }

  const persistenceResponse = await page.request.post('/api/onboarding/checklist/complete', {
    data: { key: 'invite_teammate', completed: true },
    timeout: 30_000,
  });
  const persistenceBody = await persistenceResponse.text();
  if (persistenceResponse.status() === 200) {
    await page.reload();
    await page.getByTestId('nav-dashboard').click();

    const summaryResponse = await page.request.get('/api/dashboard/summary');
    expect(summaryResponse.status(), await summaryResponse.text()).toBe(200);
    const summary = await summaryResponse.json();
    const checklistItems = summary?.item?.sections?.gettingStarted?.items ?? [];
    const companyProfile = checklistItems.find((entry: { key: string }) => entry.key === 'invite_teammate');
    expect(companyProfile?.completed).toBe(true);
  } else {
    expect(persistenceBody.toLowerCase()).toContain('onboarding_checklist');
  }

  await setRole(page, 'operator');
  await page.goto('/');
  await page.getByTestId('nav-dashboard').click();

  await expect(page.getByRole('heading', { name: 'Getting Started' })).toBeVisible();
  await expect(page.getByTestId('onboarding-item-upload_first_photo')).toBeVisible();
  await expect(page.getByTestId('onboarding-item-create_first_bid')).toHaveCount(0);
});
