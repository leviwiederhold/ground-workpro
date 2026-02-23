import { expect, test } from '@playwright/test';
import { loginViaUI, E2E_BASE_URL } from './helpers';

async function setActingRole(page: import('@playwright/test').Page, role: 'admin' | 'pm' | 'foreman' | 'mechanic' | 'operator') {
  const response = await page.request.post('/api/rbac/acting-role', {
    data: { role },
  });
  const body = await response.text();
  expect(response.status(), body).toBe(200);
  const payload = JSON.parse(body);
  expect(payload?.item?.role).toBeTruthy();
  return payload.item.role as string;
}

test('acting role switch is server-persisted and drives nav + guards', async ({ page }) => {
  await loginViaUI(page);

  await page.context().addCookies([
    {
      name: 'e2e_role',
      value: '',
      url: E2E_BASE_URL,
      expires: 0,
    },
  ]);

  await page.goto('/');
  await expect(page.getByTestId('nav-jobs')).toBeVisible();

  const effectiveOperator = await setActingRole(page, 'operator');
  expect(effectiveOperator).toBe('operator');

  await page.goto('/');
  await expect(page.getByTestId('nav-jobs')).toHaveCount(0);
  await expect(page.getByTestId('nav-finance')).toHaveCount(0);
  await expect(page.getByTestId('nav-vendors')).toHaveCount(0);

  const blocked = await page.request.get('/jobs');
  expect(blocked.status()).toBe(403);
  expect(await blocked.json()).toEqual({ error: 'Forbidden' });

  const effectiveAdmin = await setActingRole(page, 'admin');
  expect(effectiveAdmin).toBe('admin');

  await page.goto('/');
  await expect(page.getByTestId('nav-jobs')).toBeVisible();
  await expect(page.getByTestId('nav-finance')).toBeVisible();
});
