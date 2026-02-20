import { expect, type Page, test } from '@playwright/test';
import { loginViaUI } from './helpers';

async function setSubscriptionStatus(page: Page, subscriptionStatus: 'inactive' | 'active') {
  const response = await page.request.post('/api/test/set-subscription', {
    data: { subscription_status: subscriptionStatus },
  });
  expect(response.status()).toBe(200);
}

test('plan enforcement blocks writes when inactive and allows when active', async ({ page }) => {
  await loginViaUI(page);

  const created = await page.request.post('/api/bids', {
    data: { title: `E2E Billing ${Date.now()}`, status: 'draft', bid_date: '2026-02-19' },
  });
  expect(created.ok()).toBeTruthy();
  const createdJson = await created.json();
  const bidId = createdJson?.bid?.id;
  expect(bidId).toBeTruthy();

  const itemCreate = await page.request.post(`/api/bids/${bidId}/items`, {
    data: { item_type: 'custom', description: 'Subscription gate line item', quantity: 1, unit_cost: 100 },
  });
  expect(itemCreate.ok()).toBeTruthy();

  await setSubscriptionStatus(page, 'inactive');

  const blocked = await page.request.post(`/api/bids/${bidId}/send`, {
    data: { override: true, override_note: 'e2e plan enforcement check' },
  });
  expect(blocked.status()).toBe(402);
  await expect(blocked.json()).resolves.toEqual({ error: 'Subscription required' });

  const blockedShare = await page.request.post(`/api/bids/${bidId}/share`, { data: {} });
  expect(blockedShare.status()).toBe(402);
  await expect(blockedShare.json()).resolves.toEqual({ error: 'Subscription required' });

  await setSubscriptionStatus(page, 'active');

  const allowed = await page.request.post(`/api/bids/${bidId}/send`, {
    data: { override: true, override_note: 'e2e plan enforcement check' },
  });
  expect(allowed.status()).toBe(200);

  const allowedShare = await page.request.post(`/api/bids/${bidId}/share`, { data: {} });
  expect(allowedShare.status()).toBe(200);
});
