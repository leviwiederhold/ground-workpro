import { test } from '@playwright/test';

test('prod live latency + error sweep', async ({ page }) => {
  const base = process.env.E2E_BASE_URL!;
  const email = process.env.E2E_EMAIL!;
  const password = process.env.E2E_PASSWORD!;

  const issues: Array<Record<string, unknown>> = [];
  const slow: Array<Record<string, unknown>> = [];

  page.on('response', async (res) => {
    const req = res.request();
    const timing = req.timing();
    const ms = Math.max(0, (timing.responseEnd || 0) - (timing.startTime || 0));
    const status = res.status();
    const url = res.url();
    if (status >= 400 && !url.includes('/_next/')) {
      let body = '';
      try { body = await res.text(); } catch {}
      issues.push({ status, url, method: req.method(), body: body.slice(0, 140) });
    }
    if (ms > 1800 && !url.includes('/_next/')) {
      slow.push({ ms: Number(ms.toFixed(0)), status, url, method: req.method() });
    }
  });

  await page.goto(`${base}/login`);
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await page.waitForURL('**/', { timeout: 45_000 });

  const navIds = ['dashboard','schedule','jobs','team','fleet','messages','maintenance','inventory','safety','reports','bids','vendors','documents','training','finance','integrations'];
  for (const id of navIds) {
    const nav = page.getByTestId(`nav-${id}`);
    if (await nav.isVisible().catch(() => false)) {
      await nav.click();
      await page.waitForTimeout(1200);
    }
  }

  const buttons = ['Add Event','New Job','Add Employee','Add Equipment','New Bid','Add Vendor','Add Item','New Work Order','New Safety Log','Create Report'];
  for (const label of buttons) {
    const btn = page.getByRole('button', { name: label }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(250);
    }
  }

  console.log(JSON.stringify({ errors: issues.length, slowCount: slow.length, slowTop10: slow.sort((a,b)=>Number(b.ms)-Number(a.ms)).slice(0,10), issueTop10: issues.slice(0,10) }, null, 2));
});
