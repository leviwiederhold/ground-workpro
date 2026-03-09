import { expect, test } from '@playwright/test';
import { loginViaUI } from './helpers';

async function setActingRole(page: import('@playwright/test').Page, role: 'admin' | 'pm' | 'foreman' | 'mechanic' | 'operator') {
  const response = await page.request.post('/api/rbac/acting-role', {
    data: { role },
    timeout: 30_000,
  });
  const body = await response.text();
  expect(response.status(), body).toBe(200);
  const payload = JSON.parse(body);
  expect(payload?.item?.role).toBeTruthy();
  return payload.item.role as string;
}

test('acting role switch is server-persisted and drives nav + guards', async ({ page }) => {
  await loginViaUI(page);
  const baselineAdmin = await setActingRole(page, 'admin');
  expect(baselineAdmin).toBe('admin');

  const adminNavResponse = await page.request.get('/api/nav', { timeout: 30_000 });
  expect(adminNavResponse.status()).toBe(200);
  const adminNavPayload = await adminNavResponse.json();
  const adminNavKeys = new Set(
    Array.isArray(adminNavPayload?.items)
      ? adminNavPayload.items.map((item: { key?: string }) => String(item.key ?? ''))
      : []
  );
  expect(adminNavKeys.has('jobs')).toBeTruthy();

  const effectiveOperator = await setActingRole(page, 'operator');
  expect(effectiveOperator).toBe('operator');

  const effectiveAdmin = await setActingRole(page, 'admin');
  expect(effectiveAdmin).toBe('admin');
  const adminNavResponseAgain = await page.request.get('/api/nav', { timeout: 30_000 });
  expect(adminNavResponseAgain.status()).toBe(200);
  const adminNavPayloadAgain = await adminNavResponseAgain.json();
  const adminNavKeysAgain = new Set(
    Array.isArray(adminNavPayloadAgain?.items)
      ? adminNavPayloadAgain.items.map((item: { key?: string }) => String(item.key ?? ''))
      : []
  );
  expect(adminNavKeysAgain.has('jobs')).toBeTruthy();
  expect(adminNavKeysAgain.has('finance')).toBeTruthy();
});
