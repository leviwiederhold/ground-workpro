import { expect, type Page, test } from '@playwright/test';
import { loginViaUI } from './helpers';

async function setSubscriptionStatus(page: Page, subscriptionStatus: 'inactive' | 'active') {
  const response = await page.request.post('/api/test/set-subscription', {
    data: { subscription_status: subscriptionStatus },
  });
  expect(response.status()).toBe(200);
}

test('proposal pdf export returns pdf response for admin/pm', async ({ page }) => {
  await loginViaUI(page);
  await setSubscriptionStatus(page, 'active');

  const created = await page.request.post('/api/bids', {
    data: {
      title: `E2E Proposal PDF ${Date.now()}`,
      status: 'draft',
      bid_date: '2026-02-19',
    },
  });
  expect(created.ok()).toBeTruthy();

  const createdJson = await created.json();
  const bidId = createdJson?.bid?.id ?? createdJson?.item?.id;
  expect(bidId).toBeTruthy();

  const itemCreate = await page.request.post(`/api/bids/${bidId}/items`, {
    data: {
      item_type: 'custom',
      description: 'PDF line item',
      quantity: 3,
      unit_cost: 125,
    },
  });
  expect(itemCreate.ok()).toBeTruthy();

  const pdfRes = await page.request.get(`/api/bids/${bidId}/proposal-pdf`);
  expect(pdfRes.status()).toBe(200);

  const contentType = pdfRes.headers()['content-type'] || '';
  expect(contentType.toLowerCase()).toContain('application/pdf');

  const bytes = await pdfRes.body();
  expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
});
