import { expect, test, type Page } from '@playwright/test';
import { loginViaUI } from './helpers';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function goToNav(page: Page, navId: string) {
  await page.getByLabel('Open sidebar').click();
  await page.getByTestId(`nav-${navId}`).click();
}

async function closeSidebar(page: Page) {
  await page.getByLabel('Close sidebar').click({ force: true });
}

async function dismissInstallPromptIfVisible(page: Page) {
  const installHeading = page.getByRole('heading', { name: 'Install Groundwork Pro' });
  if (await installHeading.isVisible().catch(() => false)) {
    const modalButtons = page.locator('div.fixed.inset-0.z-50 button');
    if (await modalButtons.first().isVisible().catch(() => false)) {
      await modalButtons.first().click();
      return;
    }
  }

  const gotItButton = page.getByRole('button', { name: 'Got it' });
  if (await gotItButton.isVisible().catch(() => false)) {
    await gotItButton.click();
    return;
  }

  const closeButton = page.getByRole('button', { name: /^close$/i });
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
  }
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

async function getMobileShellMetrics(page: Page) {
  return page.evaluate(() => {
    const shell = document.querySelector('.mobile-app-shell');
    const header = document.querySelector('[data-testid="dashboard-header"]');
    const scrollRegion = document.querySelector('[data-testid="dashboard-scroll-region"]');
    const drawer = document.querySelector('.mobile-app-shell__drawer');
    const drawerBrand = document.querySelector('.mobile-app-shell__drawer-brand');
    const firstNavItem = document.querySelector('[data-testid="nav-dashboard"]');

    if (!shell || !header || !scrollRegion || !drawer || !drawerBrand) {
      throw new Error('Mobile shell elements are missing.');
    }

    const shellStyles = getComputedStyle(shell);
    const bodyStyles = getComputedStyle(document.body);
    const scrollStyles = getComputedStyle(scrollRegion);
    const drawerStyles = getComputedStyle(drawer);
    const brandStyles = getComputedStyle(drawerBrand);
    const shellRect = shell.getBoundingClientRect();
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;

    return {
      bodyPaddingTop: Math.round(parseFloat(bodyStyles.paddingTop) || 0),
      bodyPaddingBottom: Math.round(parseFloat(bodyStyles.paddingBottom) || 0),
      shellHeight: Math.round(shellRect.height),
      viewportHeight: Math.round(viewportHeight),
      safeTop: Math.round(parseFloat(shellStyles.getPropertyValue('--mobile-safe-top')) || 0),
      headerTop: Math.round(header.getBoundingClientRect().top),
      headerHeight: Math.round(header.getBoundingClientRect().height),
      scrollPaddingTop: Math.round(parseFloat(scrollStyles.paddingTop) || 0),
      drawerTop: Math.round(drawer.getBoundingClientRect().top),
      drawerPaddingTop: Math.round(parseFloat(drawerStyles.paddingTop) || 0),
      drawerBrandTop: Math.round(drawerBrand.getBoundingClientRect().top),
      drawerBrandPaddingTop: Math.round(parseFloat(brandStyles.paddingTop) || 0),
      firstNavTop: firstNavItem ? Math.round(firstNavItem.getBoundingClientRect().top) : null,
    };
  });
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

test('mobile app shell keeps a stable top offset through scroll, drawer, and navigation', async ({ page }) => {
  await loginViaUI(page);
  await page.goto('/');

  await expect(page.getByTestId('dashboard-header')).toBeVisible();
  await expect(page.getByTestId('dashboard-scroll-region')).toBeVisible();
  await dismissInstallPromptIfVisible(page);

  const initial = await getMobileShellMetrics(page);
  expect(initial.bodyPaddingTop).toBe(0);
  expect(initial.bodyPaddingBottom).toBe(0);
  expect(initial.shellHeight).toBeGreaterThanOrEqual(initial.viewportHeight - 1);
  expect(initial.headerTop).toBe(0);
  expect(initial.headerHeight).toBeGreaterThan(0);
  expect(initial.scrollPaddingTop).toBe(initial.headerHeight);
  expect(initial.drawerTop).toBe(0);
  expect(initial.drawerPaddingTop).toBe(initial.safeTop);
  expect(initial.drawerBrandPaddingTop).toBeGreaterThan(0);

  await page.getByTestId('dashboard-scroll-region').evaluate((element) => {
    element.scrollTo({ top: 500, behavior: 'auto' });
  });

  const afterScroll = await getMobileShellMetrics(page);
  expect(afterScroll.bodyPaddingTop).toBe(0);
  expect(afterScroll.bodyPaddingBottom).toBe(0);
  expect(afterScroll.shellHeight).toBeGreaterThanOrEqual(afterScroll.viewportHeight - 1);
  expect(afterScroll.headerTop).toBe(initial.headerTop);
  expect(afterScroll.headerHeight).toBe(initial.headerHeight);
  expect(afterScroll.scrollPaddingTop).toBe(initial.scrollPaddingTop);

  await page.getByLabel('Open sidebar').click();
  await expect(page.getByTestId('nav-dashboard')).toBeVisible();

  const drawerOpen = await getMobileShellMetrics(page);
  expect(drawerOpen.headerTop).toBe(initial.headerTop);
  expect(drawerOpen.headerHeight).toBe(initial.headerHeight);
  expect(drawerOpen.drawerTop).toBe(0);
  expect(drawerOpen.drawerPaddingTop).toBe(initial.safeTop);
  expect(drawerOpen.firstNavTop).not.toBeNull();
  expect(Number(drawerOpen.firstNavTop)).toBeGreaterThan(drawerOpen.safeTop + 40);

  await closeSidebar(page);

  const afterClose = await getMobileShellMetrics(page);
  expect(afterClose.headerTop).toBe(initial.headerTop);
  expect(afterClose.headerHeight).toBe(initial.headerHeight);

  await goToNav(page, 'jobs');
  await expectPageTitle(page, 'Jobs');

  const afterJobs = await getMobileShellMetrics(page);
  expect(afterJobs.headerTop).toBe(initial.headerTop);
  expect(afterJobs.headerHeight).toBe(initial.headerHeight);
  expect(afterJobs.scrollPaddingTop).toBe(initial.scrollPaddingTop);

  await page.getByLabel('Open sidebar').click();
  await expect(page.getByTestId('nav-dashboard')).toBeVisible();
  const drawerReopen = await getMobileShellMetrics(page);
  expect(drawerReopen.headerTop).toBe(initial.headerTop);
  expect(drawerReopen.drawerPaddingTop).toBe(initial.safeTop);
  expect(drawerReopen.firstNavTop).not.toBeNull();
  expect(Number(drawerReopen.firstNavTop)).toBeGreaterThan(drawerReopen.safeTop + 40);

  await closeSidebar(page);
});

test('iOS native header metrics match mobile web header metrics', async ({ browser, baseURL }) => {
  const webContext = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const webPage = await webContext.newPage();
  await loginViaUI(webPage);
  await webPage.goto('/');
  await expect(webPage.getByTestId('dashboard-header')).toBeVisible();
  await dismissInstallPromptIfVisible(webPage);
  const webMetrics = await getMobileShellMetrics(webPage);
  await webContext.close();

  const nativeContext = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await nativeContext.addInitScript(() => {
    Object.defineProperty(window, 'Capacitor', {
      value: {
        isNativePlatform: () => true,
        getPlatform: () => 'ios',
      },
      configurable: true,
    });
  });
  const nativePage = await nativeContext.newPage();
  await loginViaUI(nativePage);
  await nativePage.goto('/');
  await expect(nativePage.getByTestId('dashboard-header')).toBeVisible();
  await dismissInstallPromptIfVisible(nativePage);
  const nativeMetrics = await getMobileShellMetrics(nativePage);

  expect(nativeMetrics.safeTop).toBe(0);
  expect(nativeMetrics.headerTop).toBe(webMetrics.headerTop);
  expect(nativeMetrics.headerHeight).toBe(webMetrics.headerHeight);
  expect(nativeMetrics.scrollPaddingTop).toBe(webMetrics.scrollPaddingTop);
  expect(nativeMetrics.drawerPaddingTop).toBe(webMetrics.drawerPaddingTop);

  await nativeContext.close();
});
