import { test } from '@playwright/test';
import { loginViaUI } from './helpers';

const issues: Array<Record<string, unknown>> = [];

test('prod live sweep', async ({ page }) => {
  page.on('console', (msg) => {
    if (msg.type() === 'error') issues.push({ type: 'console', url: page.url(), text: msg.text() });
  });
  page.on('pageerror', (err) => issues.push({ type: 'pageerror', url: page.url(), text: String(err) }));
  page.on('response', async (res) => {
    const status = res.status();
    const url = res.url();
    if (status >= 400 && !url.includes('/_next/')) {
      let body = '';
      try { body = await res.text(); } catch {}
      issues.push({ type: 'http', status, url, body: body.slice(0, 180) });
    }
  });

  await loginViaUI(page);

  const navs = ['Dashboard','Schedule','Jobs','Team','Fleet','Messages','Maintenance','Inventory','Safety','Reports','Bids','Vendors','Documents','Training','Finance','Integrations','Settings'];
  for (const nav of navs) {
    const button = page.getByRole('button', { name: nav }).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      await page.waitForTimeout(1000);
    }
  }

  const actions = ['New Job','Add Employee','Add Equipment','Add Event','New Bid','Add Vendor','Add Item','New Work Order','New Safety Log','Create Report','Upload'];
  for (const label of actions) {
    const btn = page.getByRole('button', { name: label }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(250);
    }
  }

  console.log(JSON.stringify({ count: issues.length, issues }, null, 2));
});
