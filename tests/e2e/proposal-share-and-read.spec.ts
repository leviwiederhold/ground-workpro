import { expect, type Page, request as playwrightRequest, test } from '@playwright/test';
import { E2E_BASE_URL, loginViaUI } from './helpers';

async function setSubscriptionStatus(page: Page, subscriptionStatus: 'inactive' | 'active') {
  const response = await page.request.post('/api/test/set-subscription', {
    data: { subscription_status: subscriptionStatus },
  });
  expect(response.status()).toBe(200);
}

test('share link creation and public proposal read returns sanitized payload', async ({ page }) => {
  await loginViaUI(page);
  await setSubscriptionStatus(page, 'active');

  const title = `E2E Proposal Share ${Date.now()}`;

  const pricingResp = await page.request.put('/api/pricing-settings', {
    data: { target_margin_percent: 25, markup_percent: 1 },
  });
  expect(pricingResp.ok()).toBeTruthy();

  const bidCreate = await page.request.post('/api/bids', {
    data: { title, status: 'draft', bid_date: '2026-02-19' },
  });
  expect(bidCreate.ok()).toBeTruthy();
  const bidJson = await bidCreate.json();
  const bidId = bidJson?.bid?.id;
  expect(bidId).toBeTruthy();

  const itemCreate = await page.request.post(`/api/bids/${bidId}/items`, {
    data: { item_type: 'custom', description: 'Proposal line', quantity: 2, unit_cost: 150 },
  });
  expect(itemCreate.ok()).toBeTruthy();

  const blockedSend = await page.request.post(`/api/bids/${bidId}/send`, {
    data: { override: false },
  });
  expect(blockedSend.status()).toBe(409);

  const overrideSend = await page.request.post(`/api/bids/${bidId}/send`, {
    data: { override: true, override_note: 'approved in e2e' },
  });
  expect(overrideSend.ok()).toBeTruthy();

  const shareRes = await page.request.post(`/api/bids/${bidId}/share`, { data: {} });
  expect(shareRes.status()).toBe(200);
  const sharePayload = await shareRes.json();
  const token = sharePayload?.item?.token;
  expect(token).toBeTruthy();
  expect(sharePayload?.item?.url).toContain(`/proposal/${token}`);

  const anonContext = await playwrightRequest.newContext({ baseURL: E2E_BASE_URL });
  const proposalRes = await anonContext.get(`/api/proposals/${token}`);
  expect(proposalRes.status()).toBe(200);

  const proposalJson = await proposalRes.json();
  const item = proposalJson?.item;
  expect(item?.proposal?.bid_id).toBe(bidId);
  expect(Array.isArray(item?.items)).toBeTruthy();
  expect(item.items.length).toBeGreaterThan(0);

  const totals = item.items.reduce((sum: number, row: { total?: number | string }) => sum + Number(row.total || 0), 0);
  expect(Number(item.summary.total)).toBe(totals);

  const serialized = JSON.stringify(proposalJson);
  for (const key of ['marginPercent', 'warnings', 'targetMarginPercent', 'subtotalCost', 'profit', 'override_note']) {
    expect(serialized.includes(key)).toBeFalsy();
  }

  await anonContext.dispose();
});
