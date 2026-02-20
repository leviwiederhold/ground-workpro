import { expect, request as playwrightRequest, test } from '@playwright/test';
import { loginViaUI } from './helpers';

test('proposal share token returns sanitized public payload', async ({ page }) => {
  await loginViaUI(page);

  const title = `E2E Proposal ${Date.now()}`;

  const pricing = await page.request.put('/api/pricing-settings', {
    data: { target_margin_percent: 25, markup_percent: 1 },
  });
  expect(pricing.ok()).toBeTruthy();

  const created = await page.request.post('/api/bids', {
    data: { title, status: 'draft', bid_date: '2026-02-19' },
  });
  expect(created.ok()).toBeTruthy();
  const createdJson = await created.json();
  const bidId = createdJson?.bid?.id;
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
    data: { override: true, override_note: 'e2e approved' },
  });
  expect(overrideSend.ok()).toBeTruthy();

  const shareRes = await page.request.post(`/api/bids/${bidId}/share`, {
    data: {},
  });
  expect(shareRes.ok()).toBeTruthy();
  const shareJson = await shareRes.json();
  const token = shareJson?.item?.token;
  expect(token).toBeTruthy();

  const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3000';
  const anon = await playwrightRequest.newContext({ baseURL });
  const proposalRes = await anon.get(`/api/proposals/${token}`);
  expect(proposalRes.status()).toBe(200);

  const proposalJson = await proposalRes.json();
  const payload = proposalJson?.item;
  expect(payload?.proposal?.bid_id).toBe(bidId);
  expect(payload?.items?.length).toBeGreaterThan(0);

  const sum = payload.items.reduce((acc: number, row: any) => acc + Number(row.total || 0), 0);
  expect(Number(payload.summary.total)).toBe(sum);

  const text = JSON.stringify(proposalJson);
  for (const key of ['marginPercent', 'warnings', 'targetMarginPercent', 'subtotalCost', 'profit']) {
    expect(text.includes(key)).toBeFalsy();
  }

  await anon.dispose();
});
