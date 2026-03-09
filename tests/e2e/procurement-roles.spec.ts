import { expect, test, type Page } from '@playwright/test';
import { loginViaUI } from './helpers';

type Role = 'admin' | 'pm' | 'foreman' | 'mechanic' | 'operator';
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';

async function setRole(page: Page, role: Role) {
  let response = await page.request.post('/api/test/set-role', { data: { role } });
  let body = await response.text();

  if (response.status() === 403 && body.includes('No company membership found')) {
    const bootstrap = await page.request.post('/api/bootstrap');
    const bootstrapBody = await bootstrap.text();
    expect([200, 400]).toContain(bootstrap.status());
    if (bootstrap.status() === 400 && !bootstrapBody.toLowerCase().includes('duplicate')) {
      throw new Error(bootstrapBody);
    }
    response = await page.request.post('/api/test/set-role', { data: { role } });
    body = await response.text();
  }

  expect(response.status(), body).toBe(200);

  await page.context().addCookies([
    {
      name: 'e2e_role',
      value: role,
      url: BASE_URL,
    },
  ]);
}

test('procurement APIs are role scoped', async ({ page }) => {
  const stamp = Date.now();
  await loginViaUI(page);

  await setRole(page, 'admin');

  const vendorCreateRes = await page.request.post('/api/vendors', {
    data: { name: `e2e-vendor-${stamp}`, status: 'active' },
  });
  expect(vendorCreateRes.status()).toBe(200);
  const vendorId = String((await vendorCreateRes.json())?.vendor?.id ?? '');
  expect(vendorId).toBeTruthy();

  const inventoryCreateRes = await page.request.post('/api/inventory', {
    data: { name: `e2e-part-${stamp}`, unit: 'ea', quantity_on_hand: 10, status: 'active' },
  });
  expect(inventoryCreateRes.status()).toBe(200);
  const inventoryId = String((await inventoryCreateRes.json())?.item?.id ?? '');
  expect(inventoryId).toBeTruthy();

  const poCreateRes = await page.request.post('/api/purchase-orders', {
    data: { vendor_id: vendorId, status: 'draft', notes: `e2e-po-${stamp}` },
    timeout: 30_000,
  });
  expect(poCreateRes.status()).toBe(200);
  const poId = String((await poCreateRes.json())?.purchase_order?.id ?? '');
  expect(poId).toBeTruthy();

  await setRole(page, 'mechanic');

  const mechInventoryGet = await page.request.get('/api/inventory');
  expect(mechInventoryGet.status()).toBe(200);

  const mechInventoryPost = await page.request.post('/api/inventory', {
    data: { name: `mech-create-${stamp}`, unit: 'ea', quantity_on_hand: 1, status: 'active' },
  });
  expect(mechInventoryPost.status()).toBe(403);
  expect(await mechInventoryPost.json()).toEqual({ error: 'Forbidden' });

  const mechVendorsGet = await page.request.get('/api/vendors');
  expect(mechVendorsGet.status()).toBe(200);
  const mechVendorsJson = await mechVendorsGet.json();
  expect(Array.isArray(mechVendorsJson?.vendors ?? mechVendorsJson?.items)).toBeTruthy();

  const mechPoGet = await page.request.get('/api/purchase-orders');
  expect(mechPoGet.status()).toBe(403);
  expect(await mechPoGet.json()).toEqual({ error: 'Forbidden' });

  await setRole(page, 'foreman');

  const foremanInventoryGet = await page.request.get('/api/inventory');
  expect(foremanInventoryGet.status()).toBe(200);

  const foremanVendorsGet = await page.request.get('/api/vendors');
  expect(foremanVendorsGet.status()).toBe(200);

  const foremanPoGet = await page.request.get('/api/purchase-orders');
  expect(foremanPoGet.status()).toBe(403);

  await setRole(page, 'operator');

  const operatorInventoryGet = await page.request.get('/api/inventory');
  expect(operatorInventoryGet.status()).toBe(200);

  await setRole(page, 'pm');

  const pmVendorsGet = await page.request.get('/api/vendors');
  expect(pmVendorsGet.status()).toBe(200);

  const pmVendorPatch = await page.request.patch(`/api/vendors/${vendorId}`, {
    data: { notes: `pm-updated-${stamp}` },
  });
  expect(pmVendorPatch.status()).toBe(200);

  const pmInventoryPatch = await page.request.patch(`/api/inventory/${inventoryId}`, {
    data: { quantity_on_hand: 8 },
  });
  expect(pmInventoryPatch.status()).toBe(200);

  const pmPoDelete = await page.request.delete(`/api/purchase-orders/${poId}`);
  expect(pmPoDelete.status()).toBe(200);
  expect(await pmPoDelete.json()).toEqual({ success: true });
});
