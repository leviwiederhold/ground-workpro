import { expect, test, type Page } from '@playwright/test';
import { loginViaUI } from './helpers';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function goToNav(page: Page, navId: string) {
  await page.getByLabel('Open sidebar').click();
  await page.getByTestId(`nav-${navId}`).click();
}

async function expectPageTitle(page: Page, title: string) {
  await expect(page.locator('h1', { hasText: new RegExp(`^${title}$`, 'i') }).first()).toBeVisible();
}

async function expectNoHorizontalScroll(page: Page) {
  const hasOverflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth > root.clientWidth + 1;
  });
  expect(hasOverflow).toBeFalsy();
}

async function expectTwoColumnStats(page: Page) {
  const grid = page.getByTestId('stats-grid').first();
  await expect(grid).toBeVisible();

  const cols = await grid.evaluate((el) => {
    const styles = window.getComputedStyle(el);
    return styles.gridTemplateColumns.split(' ').filter(Boolean).length;
  });

  expect(cols).toBe(2);
}

test('mobile layout has 2-column stat cards and no horizontal page overflow', async ({ page }) => {
  await loginViaUI(page);
  await page.goto('/');

  await goToNav(page, 'fleet');
  await expectPageTitle(page, 'Fleet');
  await expectTwoColumnStats(page);
  await expectNoHorizontalScroll(page);

  await goToNav(page, 'team');
  await expectPageTitle(page, 'Team');
  await expectTwoColumnStats(page);
  await expectNoHorizontalScroll(page);

  await goToNav(page, 'inventory');
  await expectPageTitle(page, 'Inventory');
  await expectTwoColumnStats(page);
  await expectNoHorizontalScroll(page);

  await goToNav(page, 'maintenance');
  await expectPageTitle(page, 'Maintenance');
  await expectTwoColumnStats(page);
  await expectNoHorizontalScroll(page);

  await goToNav(page, 'messages');
  await expectPageTitle(page, 'Messages');
  await expectNoHorizontalScroll(page);

  await goToNav(page, 'schedule');
  await expectPageTitle(page, 'Schedule');
  await expectNoHorizontalScroll(page);
});
