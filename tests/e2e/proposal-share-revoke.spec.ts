import { expect, request as playwrightRequest, test } from '@playwright/test';
import { E2E_BASE_URL, loginViaUI } from './helpers';

test('share link can be revoked and token stops resolving publicly', async ({ page }) => {
  await loginViaUI(page);

  const title = `E2E Proposal Revoke ${Date.now()}`;

  const pricingResp = await page.request.put('/api/pricing-settings', {
    data: { target_margin_percent: 25, markup_percent: 40 },
  });
  expect(pricingResp.ok()).toBeTruthy();

  const bidCreate = await page.request.post('/api/bids', {
    data: { title, status: 'draft', bid_date: '2026-02-19' },
  });
  expect(bidCreate.ok()).toBeTruthy();
  const bidJson = await bidCreate.json();
  const bidId = bidJson?.bid?.id ?? bidJson?.item?.id;
  expect(bidId).toBeTruthy();

  const itemCreate = await page.request.post(`/api/bids/${bidId}/items`, {
    data: { item_type: 'custom', description: 'Revoke flow item', quantity: 1, unit_cost: 1000 },
  });
  expect(itemCreate.ok()).toBeTruthy();

  const firstSendRes = await page.request.post(`/api/bids/${bidId}/send`, {
    data: { override: false },
  });
  if (firstSendRes.status() === 409) {
    const overrideSendRes = await page.request.post(`/api/bids/${bidId}/send`, {
      data: { override: true, override_note: 'E2E revoke share override' },
    });
    expect(overrideSendRes.status()).toBe(200);
  } else {
    expect(firstSendRes.status()).toBe(200);
  }

  const shareRes = await page.request.post(`/api/bids/${bidId}/share`, { data: {} });
  expect(shareRes.status()).toBe(200);
  const shareJson = await shareRes.json();
  const token = shareJson?.item?.token;
  expect(token).toBeTruthy();

  const anonContext = await playwrightRequest.newContext({ baseURL: E2E_BASE_URL });

  const beforeRevoke = await anonContext.get(`/api/proposals/${token}`);
  expect(beforeRevoke.status()).toBe(200);

  const revokeRes = await page.request.post(`/api/bids/${bidId}/share/revoke`, { data: {} });
  expect(revokeRes.status()).toBe(200);
  const revokeJson = await revokeRes.json();
  expect(revokeJson).toEqual({ item: { success: true } });

  const afterRevoke = await anonContext.get(`/api/proposals/${token}`);
  expect(afterRevoke.status()).toBe(404);

  await anonContext.dispose();
});
