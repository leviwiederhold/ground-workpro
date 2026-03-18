import { expect, test, type Frame, type Page } from '@playwright/test';
import { loginViaUI } from './helpers';

async function setRole(page: Page, role: 'admin' | 'pm' | 'foreman' | 'mechanic' | 'operator') {
  const response = await page.request.post('/api/test/set-role', { data: { role } });
  const body = await response.text();
  expect(response.status(), body).toBe(200);
}

async function setSubscription(page: Page, subscriptionStatus: 'inactive' | 'trialing' | 'active' | 'past_due' | 'canceled') {
  const response = await page.request.post('/api/test/set-subscription', {
    data: { subscription_status: subscriptionStatus },
  });
  const body = await response.text();
  expect(response.status(), body).toBe(200);
}

async function expectUiUploadSuccess(page: Page, fileName: string) {
  await page.goto('/');
  await page.getByTestId('nav-documents').click();
  await expect(page.getByTestId('documents-upload-button')).toBeVisible();

  const navigations: string[] = [];
  const onMainFrameNavigation = (frame: Frame) => {
    if (frame === page.mainFrame()) {
      navigations.push(frame.url());
    }
  };
  page.on('framenavigated', onMainFrameNavigation);

  try {
    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByTestId('documents-upload-button').click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from('documents ui upload', 'utf8'),
    });

    await expect(page.getByRole('heading', { name: fileName })).toBeVisible({ timeout: 30_000 });
    expect(navigations).toEqual([]);
  } finally {
    page.off('framenavigated', onMainFrameNavigation);
  }

  await page.reload();
  await page.getByTestId('nav-documents').click();
  await expect(page.getByRole('heading', { name: fileName })).toBeVisible({ timeout: 30_000 });
}

test('documents page upload works from the UI with an active subscription', async ({ page }) => {
  await loginViaUI(page);
  await setRole(page, 'admin');
  await setSubscription(page, 'active');

  await page.goto('/');
  const fileName = `ui-doc-${Date.now()}.txt`;
  await expectUiUploadSuccess(page, fileName);
});

test('documents page upload works from the UI without an active subscription', async ({ page }) => {
  await loginViaUI(page);
  await setRole(page, 'admin');
  await setSubscription(page, 'inactive');

  const fileName = `ui-doc-inactive-${Date.now()}.txt`;
  await expectUiUploadSuccess(page, fileName);
});
