import { expect, test } from '@playwright/test';
import { loginViaUI } from './helpers';

test('bids create + add item + summary renders + delete persists', async ({ page }) => {
  await loginViaUI(page);

  await page.getByTestId('nav-bids').click();
  await expect(page.getByTestId('bids-create')).toBeVisible();

  const title = `E2E Bid ${Date.now()}`;
  const created = await page.request.post('/api/bids', {
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

  await page.getByTestId('nav-bids').click();
  await expect(page.getByTestId('bids-create')).toBeVisible();

  const pricingResp = await page.request.put('/api/pricing-settings', {
    data: { target_margin_percent: 25, markup_percent: 1 },
  });
  expect(pricingResp.ok()).toBeTruthy();

  const title = `E2E Send Gate ${Date.now()}`;
  await page.getByTestId('bids-create').click();
  await page.getByTestId('bids-title-input').fill(title);
  await page.locator('input[type="date"]').first().fill('2026-02-19');
  await page.getByTestId('bids-save').click();

  const bidRow = page.locator('[data-testid^="bid-row-"]', { hasText: title });
  await expect(bidRow).toHaveCount(1);
  await bidRow.first().click();

  await page.getByTestId('bids-add-item').click();
  await page.getByTestId('bid-item-description').fill('Send gate item');
  await page.getByTestId('bid-item-quantity').fill('1');
  await page.getByTestId('bid-item-unit-cost').fill('1000');
  await page.getByTestId('bids-item-save').click();

  await page.getByTestId('bids-send').click();
  await expect(page.getByTestId('bids-send-warning')).toContainText('Margin below target');
  await expect(page.getByTestId('bid-status-value')).not.toContainText('sent');

  await page.getByTestId('bids-send-override-checkbox').check();
  await page.getByTestId('bids-send-override-note').fill('Approved override in e2e');
  await page.getByTestId('bids-send-confirm-override').click();

  await expect(page.getByTestId('bid-status-value')).toContainText('sent');

  await page.reload();
  await page.getByTestId('nav-bids').click();
  const bidRowAfterRefresh = page.locator('[data-testid^="bid-row-"]', { hasText: title });
  await expect(bidRowAfterRefresh).toHaveCount(1);
  await bidRowAfterRefresh.first().click();
  await expect(page.getByTestId('bid-status-value')).toContainText('sent');
});
