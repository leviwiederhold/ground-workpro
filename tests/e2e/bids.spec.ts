import { expect, type Page, test } from '@playwright/test';
import { loginViaUI } from './helpers';

async function setSubscriptionStatus(page: Page, subscriptionStatus: 'inactive' | 'active') {
  const response = await page.request.post('/api/test/set-subscription', {
    data: { subscription_status: subscriptionStatus },
  });
  expect(response.status()).toBe(200);
}

test('bids create + add item + summary renders + delete persists', async ({ page }) => {
  await loginViaUI(page);
  await setSubscriptionStatus(page, 'active');

  await page.getByTestId('nav-bids').click();
  await expect(page.getByTestId('bids-create')).toBeVisible();

  const title = `E2E Bid ${Date.now()}`;
  const created = await page.request.post('/api/bids', {
    timeout: 30_000,
    data: { title, status: 'draft', bid_date: '2026-02-19' },
  });
  expect(created.ok()).toBeTruthy();
  const createdJson = await created.json();
  const bidId = createdJson?.bid?.id;
  expect(bidId).toBeTruthy();

  await page.reload();
  await page.getByTestId('nav-bids').click();

  const bidRow = page.locator(`[data-testid="bid-row-${bidId}"]`);
  await expect(bidRow).toHaveCount(1);
  await bidRow.first().click();

  await page.getByTestId('bids-add-item').click();
  await page.getByTestId('bid-item-description').fill('E2E line item');
  await page.getByTestId('bid-item-quantity').fill('2');
  await page.getByTestId('bid-item-unit-cost').fill('150');
  await page.getByTestId('bids-item-save').click();
  await expect(page.getByLabel('Close bid item modal')).toHaveCount(0, { timeout: 10_000 });

  await expect(page.getByTestId('bids-summary-margin')).toBeVisible();
  await expect(page.getByTestId('bids-summary-margin')).toContainText('%');

  page.once('dialog', async (dialog) => {
    await dialog.accept();
  });
  await page.getByTestId('bids-delete').click();

  await expect(bidRow).toHaveCount(0);

  await page.reload();
  await page.getByTestId('nav-bids').click();
  await expect(page.locator('[data-testid^="bid-row-"]', { hasText: title })).toHaveCount(0);
});

test('send flow blocks below target margin, then allows override', async ({ page }) => {
  await loginViaUI(page);
  await setSubscriptionStatus(page, 'active');

  await page.getByTestId('nav-bids').click();
  await expect(page.getByTestId('bids-create')).toBeVisible();

  const pricingResp = await page.request.put('/api/pricing-settings', {
    data: { target_margin_percent: 25, markup_percent: 1 },
  });
  expect(pricingResp.ok()).toBeTruthy();

  const title = `E2E Send Gate ${Date.now()}`;
  const created = await page.request.post('/api/bids', {
    timeout: 30_000,
    data: { title, status: 'draft', bid_date: '2026-02-19' },
  });
  expect(created.ok()).toBeTruthy();
  const createdJson = await created.json();
  const bidId = createdJson?.bid?.id;
  expect(bidId).toBeTruthy();

  await page.reload();
  await page.getByTestId('nav-bids').click();
  const bidRow = page.locator('[data-testid^="bid-row-"]', { hasText: title });
  await expect(bidRow).toHaveCount(1);
  await bidRow.first().click();

  await page.getByTestId('bids-add-item').click();
  await page.getByTestId('bid-item-description').fill('Send gate item');
  await page.getByTestId('bid-item-quantity').fill('1');
  await page.getByTestId('bid-item-unit-cost').fill('1000');
  await page.getByTestId('bids-item-save').click();
  await expect(page.getByLabel('Close bid item modal')).toHaveCount(0, { timeout: 10_000 });

  const blocked = await page.request.post(`/api/bids/${bidId}/send`, {
    data: { override: false },
  });
  expect(blocked.status()).toBe(409);
  await expect(blocked.json()).resolves.toMatchObject({ error: 'Margin below target' });
  const allowed = await page.request.post(`/api/bids/${bidId}/send`, {
    data: { override: true, override_note: 'Approved override in e2e' },
  });
  expect(allowed.status()).toBe(200);

  await page.reload();
  await page.getByTestId('nav-bids').click();
  const bidRowAfterRefresh = page.locator('[data-testid^="bid-row-"]', { hasText: title });
  await expect(bidRowAfterRefresh).toHaveCount(1);
});

test('bid edit persists client date probability', async ({ page }) => {
  await loginViaUI(page);
  await setSubscriptionStatus(page, 'active');

  await page.getByTestId('nav-bids').click();
  await expect(page.getByTestId('bids-create')).toBeVisible();

  const title = `E2E Persist ${Date.now()}`;
  const created = await page.request.post('/api/bids', {
    timeout: 30_000,
    data: { title, status: 'draft' },
  });
  expect(created.ok()).toBeTruthy();
  const createdJson = await created.json();
  const bidId = String(createdJson?.bid?.id ?? '');
  expect(bidId).toBeTruthy();

  await page.reload();
  await page.getByTestId('nav-bids').click();
  const bidRow = page.locator(`[data-testid="bid-row-${bidId}"]`);
  await expect(bidRow).toHaveCount(1);
  await bidRow.first().click();

  await page.getByRole('button', { name: 'Edit' }).first().click();
  await page.getByTestId('bids-title-input').fill(title);
  await page.getByTestId('bids-client-input').fill('Acme Client');
  await page.getByTestId('bids-bid-date-input').fill('2026-03-10');
  await page.getByTestId('bids-probability-input').fill('55');
  await page.getByTestId('bids-save').click();
  await expect(page.getByLabel('Close bid modal')).toHaveCount(0, { timeout: 10_000 });

  await page.reload();
  await page.getByTestId('nav-bids').click();
  const refreshed = await page.request.get('/api/bids');
  expect(refreshed.ok()).toBeTruthy();
  const refreshedJson = await refreshed.json();
  const row = (refreshedJson?.bids ?? []).find((item: { id: string }) => String(item.id) === bidId);
  expect(row).toBeTruthy();
  expect(String(row.client ?? '')).toBe('Acme Client');
  expect(String(row.bid_date ?? row.bidDate ?? '')).toBe('2026-03-10');
  expect(Number(row.probability ?? 0)).toBe(55);
});
