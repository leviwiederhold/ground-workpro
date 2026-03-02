import { expect, test } from '@playwright/test';
import { getE2ECreds } from './helpers';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test('mobile critical flows run without console errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });

  await page.request.post('/api/logout');

  const { email, password } = getE2ECreds();
  await page.goto('/login');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  try {
    await page.waitForURL('**/', { timeout: 20_000 });
  } catch {
    await expect(page.getByTestId('nav-dashboard')).toBeVisible();
  }

  const roleRes = await page.request.post('/api/test/set-role', { data: { role: 'admin' } });
  expect(roleRes.status()).toBe(200);
  await page.context().addCookies([{ name: 'e2e_role', value: 'admin', url: process.env.E2E_BASE_URL || 'http://localhost:3000' }]);

  let subRes = await page.request.post('/api/test/set-subscription', {
    data: { subscription_status: 'active' },
    timeout: 30_000,
  });
  if (!subRes.ok()) {
    subRes = await page.request.post('/api/test/set-subscription', {
      data: { subscription_status: 'active' },
      timeout: 30_000,
    });
  }
  expect(subRes.status()).toBe(200);

  const createBidRes = await page.request.post('/api/bids', {
    data: {
      title: `Mobile Flow Bid ${Date.now()}`,
      status: 'draft',
      bid_date: '2026-02-20',
    },
  });
  expect(createBidRes.status()).toBe(200);
  const createBidJson = await createBidRes.json();
  const bidId = createBidJson?.bid?.id ?? createBidJson?.item?.id;
  expect(bidId).toBeTruthy();

  const createItemRes = await page.request.post(`/api/bids/${bidId}/items`, {
    data: {
      item_type: 'custom',
      description: 'Mobile flow line item',
      quantity: 1,
      unit_cost: 1000,
    },
  });
  expect(createItemRes.status()).toBe(200);

  const sendRes = await page.request.post(`/api/bids/${bidId}/send`, {
    data: { override: true, override_note: 'mobile flow' },
  });
  expect(sendRes.status()).toBe(200);

  await page.getByLabel('Open sidebar').click();
  await page.getByTestId('nav-bids').click();
  await expect(page.locator('h1', { hasText: /^bids$/i }).first()).toBeVisible();

  const shareRes = await page.request.post(`/api/bids/${bidId}/share`, { data: {} });
  expect(shareRes.status()).toBe(200);
  const shareJson = await shareRes.json();
  const shareUrl = shareJson?.item?.url;
  expect(shareUrl).toBeTruthy();

  await page.goto(shareUrl);
  await expect(page.getByTestId('proposal-status')).toBeVisible();

  const approveButton = page.getByTestId('proposal-approve-button');
  if (await approveButton.isVisible()) {
    await approveButton.click();
  }

  await expect(page.getByTestId('proposal-approved-badge')).toBeVisible();

  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
  expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
});
