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
  await page.context().addCookies([{ name: 'e2e_role', value: role, url: BASE_URL }]);
}

function readFleetItems(json: unknown): Array<{ id: string; name: string; derivedStatus: string; currentJobName: string | null }> {
  const payload = (json ?? {}) as { items?: Array<Record<string, unknown>> };
  const rows = Array.isArray(payload.items) ? payload.items : [];
  return rows.map((row) => ({
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    derivedStatus: String(row.derivedStatus ?? ''),
    currentJobName: row.currentJob && typeof row.currentJob === 'object'
      ? String((row.currentJob as Record<string, unknown>).name ?? '')
      : null,
  }));
}

test('fleet derived status endpoint and view wiring', async ({ page }) => {
  await loginViaUI(page);
  await setRole(page, 'admin');

  const stamp = Date.now();

  const jobRes = await page.request.post('/api/jobs', {
    data: { name: `fleet-status-job-${stamp}`, status: 'in_progress' },
  });
  expect(jobRes.status()).toBe(200);
  const jobId = String((await jobRes.json())?.job?.id ?? '');
  expect(jobId).toBeTruthy();

  const assignedEqRes = await page.request.post('/api/equipment', {
    data: { name: `fleet-assigned-${stamp}`, status: 'active' },
  });
  expect(assignedEqRes.status()).toBe(200);
  const assignedEquipmentId = String((await assignedEqRes.json())?.equipment?.id ?? '');
  expect(assignedEquipmentId).toBeTruthy();

  const maintEqRes = await page.request.post('/api/equipment', {
    data: { name: `fleet-maint-${stamp}`, status: 'active' },
  });
  expect(maintEqRes.status()).toBe(200);
  const maintenanceEquipmentId = String((await maintEqRes.json())?.equipment?.id ?? '');
  expect(maintenanceEquipmentId).toBeTruthy();

  const assignRes = await page.request.post('/api/schedule/assignments', {
    data: {
      jobId,
      date: new Date().toISOString().slice(0, 10),
      equipmentId: assignedEquipmentId,
      notes: 'e2e assignment',
    },
  });
  expect([200, 409]).toContain(assignRes.status());

  const woRes = await page.request.post('/api/work-orders', {
    data: {
      equipmentId: maintenanceEquipmentId,
      type: 'repair',
      priority: 'high',
      status: 'scheduled',
      title: `WO ${stamp}`,
      description: 'status engine test',
    },
  });
  expect(woRes.status()).toBe(200);

  const fleetApiRes = await page.request.get('/api/fleet/equipment');
  const fleetApiJson = await fleetApiRes.json();
  expect(fleetApiRes.status()).toBe(200);
  const items = readFleetItems(fleetApiJson);

  const assignedItem = items.find((row) => row.id === assignedEquipmentId);
  expect(assignedItem).toBeTruthy();
  expect(assignedItem?.derivedStatus).toBe('ASSIGNED');
  expect(assignedItem?.currentJobName).toContain(`fleet-status-job-${stamp}`);

  const maintenanceItem = items.find((row) => row.id === maintenanceEquipmentId);
  expect(maintenanceItem).toBeTruthy();
  expect(['IN_MAINTENANCE', 'OUT_OF_SERVICE']).toContain(String(maintenanceItem?.derivedStatus));

  await page.goto('/');
  await page.getByTestId('nav-fleet').click();
  await expect(page.getByTestId(`fleet-row-${assignedEquipmentId}`)).toBeVisible();
  await expect(page.getByText('ASSIGNED').first()).toBeVisible();

  await setRole(page, 'operator');
  const operatorFleetRes = await page.request.get('/api/fleet/equipment');
  expect(operatorFleetRes.status()).toBe(403);
  expect(await operatorFleetRes.json()).toEqual({ error: 'Forbidden' });
});
