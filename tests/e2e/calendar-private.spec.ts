import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { loginViaUI } from './helpers';

type Role = 'admin' | 'pm' | 'foreman' | 'mechanic' | 'operator';

async function setRole(page: Page, role: Role) {
  const response = await page.request.post('/api/test/set-role', { data: { role } });
  const body = await response.text();
  expect(response.status(), body).toBe(200);
}

function getWeekStartKey(date = new Date()) {
  const normalized = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = normalized.getUTCDay();
  const offsetToMonday = day === 0 ? -6 : 1 - day;
  normalized.setUTCDate(normalized.getUTCDate() + offsetToMonday);
  return normalized.toISOString().slice(0, 10);
}

async function signupFreshPm(browser: Browser, stamp: number): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();

  const email = `pm-private-${stamp}@example.com`;
  const password = '111111';

  await page.goto('/signup');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();

  await page.waitForURL(/\/$/, { timeout: 30_000 });

  const bootstrap = await page.request.post('/api/bootstrap');
  expect([200, 400]).toContain(bootstrap.status());

  await setRole(page, 'pm');
  return { context, page };
}

test('CEO private event is visible only to creator and hidden from PM user', async ({ page, browser }) => {
  await loginViaUI(page);
  await setRole(page, 'admin');

  const stamp = Date.now();
  const weekStart = getWeekStartKey();
  const title = `CEO Private ${stamp}`;

  const createRes = await page.request.post('/api/calendar/events', {
    data: {
      title,
      startsAt: `${weekStart}T09:00:00.000Z`,
      endsAt: `${weekStart}T10:00:00.000Z`,
      visibility: 'private',
      eventType: 'internal',
      attendees: [],
    },
  });
  const createBody = await createRes.text();
  if (createRes.status() === 400 && createBody.includes('calendar_events')) {
    test.skip(true, 'calendar tables are not present in this environment');
  }
  expect(createRes.status(), createBody).toBe(200);

  const creatorWeekRes = await page.request.get(`/api/calendar/week?start=${weekStart}`);
  const creatorWeekBody = await creatorWeekRes.text();
  expect(creatorWeekRes.status(), creatorWeekBody).toBe(200);
  const creatorWeek = JSON.parse(creatorWeekBody);
  expect((creatorWeek.items || []).some((item: { title: string }) => item.title === title)).toBe(true);

  const { context: pmContext, page: pmPage } = await signupFreshPm(browser, stamp);
  const pmWeekRes = await pmPage.request.get(`/api/calendar/week?start=${weekStart}`);
  const pmWeekBody = await pmWeekRes.text();
  expect(pmWeekRes.status(), pmWeekBody).toBe(200);
  const pmWeek = JSON.parse(pmWeekBody);
  expect((pmWeek.items || []).some((item: { title: string }) => item.title === title)).toBe(false);

  await pmContext.close();
});
