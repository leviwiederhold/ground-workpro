import { expect, test } from '@playwright/test';
import { loginViaUI } from './helpers';

test('public proposal page approves sent bid and prevents re-approval', async ({ page }) => {
  await loginViaUI(page);

  const subscriptionRes = await page.request.post('/api/test/set-subscription', {
    data: { subscription_status: 'active' },
    timeout: 30_000,
  });
  expect(subscriptionRes.status()).toBe(200);

  const title = `E2E Proposal Approve ${Date.now()}`;

  const pricing = await page.request.put('/api/pricing-settings', {
    data: { target_margin_percent: 25, markup_percent: 40 },
    timeout: 30_000,
  });
  expect(pricing.ok()).toBeTruthy();

  const bidCreate = await page.request.post('/api/bids', {
    data: { title, status: 'draft', bid_date: '2026-02-19' },
    timeout: 30_000,
  });
  expect(bidCreate.ok()).toBeTruthy();
  const bidJson = await bidCreate.json();
  const bidId = bidJson?.bid?.id;
  expect(bidId).toBeTruthy();

  const itemCreate = await page.request.post(`/api/bids/${bidId}/items`, {
    data: { item_type: 'custom', description: 'Approve flow line', quantity: 1, unit_cost: 1000 },
    timeout: 30_000,
  });
  expect(itemCreate.ok()).toBeTruthy();

  const sendRes = await page.request.post(`/api/bids/${bidId}/send`, {
    data: { override: false },
    timeout: 30_000,
  });
  expect(sendRes.status()).toBe(200);

  const shareRes = await page.request.post(`/api/bids/${bidId}/share`, { data: {}, timeout: 30_000 });
  expect(shareRes.status()).toBe(200);
  const shareJson = await shareRes.json();
  const token = shareJson?.item?.token;
  expect(token).toBeTruthy();

  await page.goto(`/proposal/${token}`);
  await expect(page.getByTestId('proposal-project')).toContainText(title);
  await expect(page.getByTestId('proposal-status')).toContainText('sent');

  await page.getByTestId('proposal-approve-button').click();
  await expect(page.getByTestId('proposal-status')).toContainText('accepted');
  await expect(page.getByTestId('proposal-approved-badge')).toBeVisible();
  await expect(page.getByTestId('proposal-approve-button')).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId('proposal-status')).toContainText('accepted');
  await expect(page.getByTestId('proposal-approved-badge')).toBeVisible();
  await expect(page.getByTestId('proposal-approve-button')).toHaveCount(0);

  const secondApprove = await page.request.post(`/api/proposals/${token}/approve`, { timeout: 30_000 });
  expect(secondApprove.status()).toBe(409);
});
