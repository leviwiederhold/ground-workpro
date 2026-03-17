import { expect, test, type Page } from '@playwright/test';
import { loginViaUI } from './helpers';

async function setRole(page: Page, role: 'admin' | 'pm' | 'foreman' | 'mechanic' | 'operator') {
  const response = await page.request.post('/api/test/set-role', { data: { role } });
  const body = await response.text();
  expect(response.status(), body).toBe(200);
}

test('documents page upload works from the UI', async ({ page }) => {
  await loginViaUI(page);
  await setRole(page, 'admin');
  const subscriptionResponse = await page.request.post('/api/test/set-subscription', {
    data: { subscription_status: 'active' },
  });
  expect(subscriptionResponse.status()).toBe(200);

  await page.goto('/');
  await page.getByTestId('nav-documents').click();
  await expect(page.getByTestId('documents-upload-button')).toBeVisible();

  const fileName = `ui-doc-${Date.now()}.txt`;
  await page.getByTestId('documents-upload-input').setInputFiles({
    name: fileName,
    mimeType: 'text/plain',
    buffer: Buffer.from('documents ui upload', 'utf8'),
  });

  await expect(page.getByRole('heading', { name: fileName })).toBeVisible({ timeout: 30_000 });
});
