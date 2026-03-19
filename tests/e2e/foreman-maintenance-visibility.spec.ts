import { expect, test, type Page } from '@playwright/test';
import { getE2ECreds } from './helpers';

async function setRole(page: Page, role: 'admin' | 'pm' | 'foreman' | 'mechanic' | 'operator') {
  const response = await page.request.post('/api/test/set-role', { data: { role } });
  const body = await response.text();
  expect(response.status(), body).toBe(200);
}

async function applyModuleAccess(
  page: Page,
  updates: Array<{ module_key: 'jobs' | 'fleet' | 'maintenance'; access_level: 'none' | 'view' | 'edit' }>
) {
  const response = await page.request.post('/api/test/module-permissions', {
    data: { permissions: updates },
  });
  expect(response.status(), await response.text()).toBe(200);
}

test('foreman maintenance visibility does not depend on fleet permission', async ({ page }) => {
  const { email } = getE2ECreds();
  const stamp = Date.now();

  const { password } = getE2ECreds();
  const login = await page.request.post('/api/test/login', {
    data: { email, password },
  });
  expect(login.status(), await login.text()).toBe(200);
  await setRole(page, 'admin');

  const dueSoonEquipmentRes = await page.request.post('/api/equipment', {
    data: {
      name: `Foreman Maintenance Eq ${stamp}`,
      status: 'active',
      hours: 1200,
      nextService: 1300,
    },
  });
  expect(dueSoonEquipmentRes.status(), await dueSoonEquipmentRes.text()).toBe(200);
  const equipmentId = String((await dueSoonEquipmentRes.json())?.equipment?.id ?? '');
  expect(equipmentId).toBeTruthy();

  const workOrderRes = await page.request.post('/api/work-orders', {
    data: {
      equipmentId,
      title: `Foreman Maintenance WO ${stamp}`,
      type: 'preventive',
      priority: 'medium',
      status: 'scheduled',
      description: 'Expected foreman-visible maintenance item',
    },
  });
  expect(workOrderRes.status(), await workOrderRes.text()).toBe(200);
  const workOrderId = String((await workOrderRes.json())?.workOrder?.id ?? '');
  expect(workOrderId).toBeTruthy();

  const employeesRes = await page.request.get('/api/employees');
  expect(employeesRes.status()).toBe(200);
  const employeesJson = await employeesRes.json();
  const existing = (employeesJson?.employees ?? []).find(
    (employee: Record<string, unknown>) => String(employee.email ?? '').toLowerCase() === email.toLowerCase()
  );

  let employeeId = existing?.id as string | undefined;
  if (!employeeId) {
    const createEmployeeRes = await page.request.post('/api/employees', {
      data: {
        name: `Foreman Viewer ${stamp}`,
        role: 'Foreman',
        email,
      },
    });
    expect(createEmployeeRes.status()).toBe(200);
    employeeId = (await createEmployeeRes.json())?.employee?.id;
  }
  expect(employeeId).toBeTruthy();

  await setRole(page, 'foreman');
  await applyModuleAccess(page, [
    { module_key: 'fleet', access_level: 'none' },
    { module_key: 'maintenance', access_level: 'view' },
  ]);

  const fleetEquipmentBlocked = await page.request.get('/api/equipment');
  expect(fleetEquipmentBlocked.status()).toBe(403);

  const maintenanceEquipmentRes = await page.request.get('/api/equipment?context=maintenance');
  expect(maintenanceEquipmentRes.status(), await maintenanceEquipmentRes.text()).toBe(200);
  const maintenanceEquipmentJson = await maintenanceEquipmentRes.json();
  const maintenanceEquipment = Array.isArray(maintenanceEquipmentJson?.items)
    ? maintenanceEquipmentJson.items
    : Array.isArray(maintenanceEquipmentJson?.equipment)
      ? maintenanceEquipmentJson.equipment
      : [];
  expect(maintenanceEquipment.some((item: { id?: string }) => String(item.id ?? '') === equipmentId)).toBe(true);

  const workOrdersListRes = await page.request.get('/api/work-orders');
  expect(workOrdersListRes.status(), await workOrdersListRes.text()).toBe(200);
  const workOrdersJson = await workOrdersListRes.json();
  const workOrders = Array.isArray(workOrdersJson?.items)
    ? workOrdersJson.items
    : Array.isArray(workOrdersJson?.workOrders)
      ? workOrdersJson.workOrders
      : [];
  expect(workOrders.some((item: { id?: string }) => String(item.id ?? '') === workOrderId)).toBe(true);
});
