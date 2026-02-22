import { expect, test, type Page } from '@playwright/test';
import { getE2ECreds } from './helpers';

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

function readWorkOrders(json: unknown): Array<{ id: string; equipmentId: string | null }> {
  const payload = (json ?? {}) as { items?: unknown; workOrders?: unknown };
  const rows = Array.isArray(payload.items)
    ? (payload.items as Array<Record<string, unknown>>)
    : Array.isArray(payload.workOrders)
      ? (payload.workOrders as Array<Record<string, unknown>>)
      : [];

  return rows.map((row) => ({
    id: String(row.id),
    equipmentId: row.equipmentId === null || row.equipmentId === undefined ? null : String(row.equipmentId),
  }));
}

test('work orders role workflow is enforced', async ({ page }) => {
  const { email } = getE2ECreds();
  const stamp = Date.now();

  await setRole(page, 'admin');

  const assignedJobRes = await page.request.post('/api/jobs', {
    data: { name: `e2e-wo-assigned-job-${stamp}`, status: 'in_progress' },
  });
  expect(assignedJobRes.status()).toBe(200);
  const assignedJobId = String((await assignedJobRes.json())?.job?.id ?? '');
  expect(assignedJobId).toBeTruthy();

  const unassignedJobRes = await page.request.post('/api/jobs', {
    data: { name: `e2e-wo-unassigned-job-${stamp}`, status: 'in_progress' },
  });
  expect(unassignedJobRes.status()).toBe(200);
  const unassignedJobId = String((await unassignedJobRes.json())?.job?.id ?? '');
  expect(unassignedJobId).toBeTruthy();

  const assignedEquipmentRes = await page.request.post('/api/equipment', {
    data: { name: `e2e-wo-assigned-eq-${stamp}`, status: 'active' },
  });
  expect(assignedEquipmentRes.status()).toBe(200);
  const assignedEquipmentId = String((await assignedEquipmentRes.json())?.equipment?.id ?? '');
  expect(assignedEquipmentId).toBeTruthy();

  const unassignedEquipmentRes = await page.request.post('/api/equipment', {
    data: { name: `e2e-wo-unassigned-eq-${stamp}`, status: 'active' },
  });
  expect(unassignedEquipmentRes.status()).toBe(200);
  const unassignedEquipmentId = String((await unassignedEquipmentRes.json())?.equipment?.id ?? '');
  expect(unassignedEquipmentId).toBeTruthy();

  const attachEquipmentRes = await page.request.post(`/api/jobs/${assignedJobId}/equipment`, {
    data: { equipment_id: assignedEquipmentId },
  });
  expect([200, 409]).toContain(attachEquipmentRes.status());

  const employeesRes = await page.request.get('/api/employees');
  expect(employeesRes.status()).toBe(200);
  const employeesJson = (await employeesRes.json()) as { employees?: Array<Record<string, unknown>> };
  const existingEmployee = (employeesJson.employees ?? []).find(
    (employee) => String(employee.email ?? '').toLowerCase() === email.toLowerCase()
  );

  let employeeId = existingEmployee ? String(existingEmployee.id ?? '') : '';
  if (!employeeId) {
    const createEmployeeRes = await page.request.post('/api/employees', {
      data: {
        name: `E2E WO Employee ${stamp}`,
        role: 'Foreman',
        email,
      },
    });
    expect(createEmployeeRes.status()).toBe(200);
    employeeId = String((await createEmployeeRes.json())?.employee?.id ?? '');
  }
  expect(employeeId).toBeTruthy();

  const assignEmployeeRes = await page.request.post(`/api/jobs/${assignedJobId}/employees`, {
    data: { employee_id: employeeId },
  });
  expect([200, 409]).toContain(assignEmployeeRes.status());

  await setRole(page, 'mechanic');
  const mechanicCreateRes = await page.request.post('/api/work-orders', {
    data: {
      equipmentId: assignedEquipmentId,
      title: `e2e wo ${stamp}`,
      type: 'repair',
      priority: 'medium',
      status: 'scheduled',
      description: 'created by mechanic',
    },
  });
  expect(mechanicCreateRes.status()).toBe(200);
  const createdWorkOrderId = String((await mechanicCreateRes.json())?.workOrder?.id ?? '');
  expect(createdWorkOrderId).toBeTruthy();

  const mechanicPatchRes = await page.request.patch(`/api/work-orders/${createdWorkOrderId}`, {
    data: { title: `e2e wo updated ${stamp}` },
  });
  expect(mechanicPatchRes.status()).toBe(200);

  await setRole(page, 'operator');
  const operatorListRes = await page.request.get('/api/work-orders');
  expect(operatorListRes.status()).toBe(403);
  expect(await operatorListRes.json()).toEqual({ error: 'Forbidden' });

  const operatorPatchRes = await page.request.patch(`/api/work-orders/${createdWorkOrderId}`, {
    data: { status: 'scheduled' },
  });
  expect(operatorPatchRes.status()).toBe(403);
  expect(await operatorPatchRes.json()).toEqual({ error: 'Forbidden' });

  await setRole(page, 'foreman');
  const foremanListRes = await page.request.get('/api/work-orders');
  expect(foremanListRes.status()).toBe(200);
  const foremanItems = readWorkOrders(await foremanListRes.json());
  expect(foremanItems.some((wo) => wo.id === createdWorkOrderId && wo.equipmentId === assignedEquipmentId)).toBe(true);

  await setRole(page, 'admin');
  const adminDeleteRes = await page.request.delete(`/api/work-orders/${createdWorkOrderId}`);
  expect(adminDeleteRes.status()).toBe(200);
  expect(await adminDeleteRes.json()).toEqual({ success: true });

  await setRole(page, 'mechanic');
  const mechanicDeleteRes = await page.request.delete(`/api/work-orders/${createdWorkOrderId}`);
  expect(mechanicDeleteRes.status()).toBe(403);
  expect(await mechanicDeleteRes.json()).toEqual({ error: 'Forbidden' });

  await setRole(page, 'pm');
  const pmListRes = await page.request.get('/api/work-orders');
  expect(pmListRes.status()).toBe(200);

  const pmCreateRes = await page.request.post('/api/work-orders', {
    data: {
      equipmentId: unassignedEquipmentId,
      title: `pm create should fail ${stamp}`,
      type: 'repair',
      priority: 'medium',
      status: 'scheduled',
    },
  });
  expect(pmCreateRes.status()).toBe(403);
  expect(await pmCreateRes.json()).toEqual({ error: 'Forbidden' });

  const pmPatchRes = await page.request.patch(`/api/work-orders/${createdWorkOrderId}`, {
    data: { status: 'scheduled' },
  });
  expect(pmPatchRes.status()).toBe(403);
  expect(await pmPatchRes.json()).toEqual({ error: 'Forbidden' });
});
