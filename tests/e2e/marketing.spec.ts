import { expect, test } from '@playwright/test';

test.use({
  storageState: { cookies: [], origins: [] },
});

test('marketing pages navigation + auth CTAs', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('link', { name: 'Features' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Pricing' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Testimonials' }).first()).toBeVisible();

  await page.getByRole('link', { name: 'Features' }).first().click();
  await expect(page).toHaveURL(/\/features$/);
  await expect(page.getByRole('heading', { name: 'Features' })).toBeVisible();

  await page.getByRole('link', { name: 'Pricing' }).first().click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByRole('heading', { name: 'Pricing' })).toBeVisible();

  await page.getByRole('link', { name: 'Testimonials' }).first().click();
  await expect(page).toHaveURL(/\/testimonials$/);
  await expect(page.getByRole('heading', { name: 'Testimonials' })).toBeVisible();

  await page.getByRole('link', { name: 'Log In' }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByTestId('login-submit')).toBeVisible();

  await page.goto('/');
  await page.getByRole('button', { name: 'Start Free Trial' }).first().click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();
});
