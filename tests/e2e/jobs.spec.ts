import { expect, test } from '@playwright/test';
import { loginViaUI } from './helpers';

test('login + jobs create/delete persists across refresh', async ({ page }) => {
  await loginViaUI(page);

  await page.getByTestId('nav-jobs').click();
  await expect(page.getByTestId('jobs-create')).toBeVisible();

  const createResponsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/jobs') && response.request().method() === 'POST' && response.status() === 200
  );
  await page.getByTestId('jobs-create').click();
  const createResponse = await createResponsePromise;
  const createdPayload = await createResponse.json();
  const createdId = createdPayload?.job?.id;
  expect(createdId).toBeTruthy();
  const createdRow = page.getByTestId(`job-row-${createdId}`);
  await expect(createdRow).toBeVisible();
  await createdRow.click();

  page.once('dialog', async (dialog) => {
    await dialog.accept();
  });
  const deleteResponsePromise = page.waitForResponse(
    (response) => response.url().includes(`/api/jobs/${createdId}`) && response.request().method() === 'DELETE' && response.status() === 200
  );
  await page.getByTestId('jobs-delete').click();
  await deleteResponsePromise;

  await expect(createdRow).toHaveCount(0);

  await page.reload();
  await page.getByTestId('nav-jobs').click();
  await expect(page.getByTestId(`job-row-${createdId}`)).toHaveCount(0);
});
