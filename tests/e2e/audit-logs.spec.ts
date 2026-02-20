import { expect, type Page, test } from '@playwright/test';
import { loginViaUI } from './helpers';

async function setSubscriptionStatus(page: Page, subscriptionStatus: 'inactive' | 'active') {
  const response = await page.request.post('/api/test/set-subscription', {
    data: { subscription_status: subscriptionStatus },
  });
  expect(response.status()).toBe(200);
}

test('send bid writes audit event and can be read via audit logs API', async ({ page }) => {
  await loginViaUI(page);
  await setSubscriptionStatus(page, 'active');

  const bidCreate = await page.request.post('/api/bids', {
    data: { title: `E2E Audit ${Date.now()}`, status: 'draft', bid_date: '2026-02-20' },
  });
  expect(bidCreate.status()).toBe(200);
  const bidJson = await bidCreate.json();
  const bidId = bidJson?.bid?.id;
  expect(bidId).toBeTruthy();

  const itemCreate = await page.request.post(`/api/bids/${bidId}/items`, {
    data: {
      item_type: 'custom',
      description: 'Audit event line item',
      quantity: 1,
      unit_cost: 100,
    },
  });
  expect(itemCreate.status()).toBe(200);

  const send = await page.request.post(`/api/bids/${bidId}/send`, {
    data: { override: true, override_note: 'e2e audit send' },
  });
  expect(send.status()).toBe(200);

  const logs = await page.request.get('/api/audit-logs');
  expect(logs.status()).toBe(200);
  const logsJson = await logs.json();
  const items = logsJson?.items ?? [];
  expect(Array.isArray(items)).toBeTruthy();

  const event = items.find(
    (item: { event_type?: string; entity_type?: string; entity_id?: string }) =>
      item?.event_type === 'bid.sent' &&
      item?.entity_type === 'bid' &&
      String(item?.entity_id) === String(bidId)
  );

  expect(event).toBeTruthy();
});
