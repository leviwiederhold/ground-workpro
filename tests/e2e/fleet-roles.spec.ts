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

function readEquipmentItems(json: unknown): Array<{ id: string; name: string }> {
  const payload = (json ?? {}) as { items?: unknown; equipment?: unknown };
  const rows = Array.isArray(payload.items)
    ? (payload.items as Array<Record<string, unknown>>)
    : Array.isArray(payload.equipment)
      ? (payload.equipment as Array<Record<string, unknown>>)
      : [];
  return rows.map((row) => ({ id: String(row.id), name: String(row.name ?? '') }));
}

test('fleet/equipment API is role scoped', async ({ page }) => {
  const { email } = getE2ECreds();
  const stamp = Date.now();

  await setRole(page, 'admin');

  const createAssignedJobRes = await page.request.post('/api/jobs', {
    data: { name: `e2e-fleet-assigned-job-${stamp}`, status: 'in_progress' },
  });
  expect(createAssignedJobRes.status()).toBe(200);
  const assignedJobId = String((await createAssignedJobRes.json())?.job?.id ?? '');
  expect(assignedJobId).toBeTruthy();

  const createUnassignedJobRes = await page.request.post('/api/jobs', {
    data: { name: `e2e-fleet-unassigned-job-${stamp}`, status: 'in_progress' },
  });
  expect(createUnassignedJobRes.status()).toBe(200);
  const unassignedJobId = String((await createUnassignedJobRes.json())?.job?.id ?? '');
  expect(unassignedJobId).toBeTruthy();

  const createAssignedEquipmentRes = await page.request.post('/api/equipment', {
    data: { name: `e2e-assigned-equipment-${stamp}`, status: 'active' },
  });
  expect(createAssignedEquipmentRes.status()).toBe(200);
  const assignedEquipmentId = String((await createAssignedEquipmentRes.json())?.equipment?.id ?? '');
  expect(assignedEquipmentId).toBeTruthy();

  const createUnassignedEquipmentRes = await page.request.post('/api/equipment', {
    data: { name: `e2e-unassigned-equipment-${stamp}`, status: 'active' },
  });
  expect(createUnassignedEquipmentRes.status()).toBe(200);
  const unassignedEquipmentId = String((await createUnassignedEquipmentRes.json())?.equipment?.id ?? '');
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
        name: `E2E Fleet Employee ${stamp}`,
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

  await setRole(page, 'foreman');
  const foremanEquipmentRes = await page.request.get('/api/equipment');
  expect(foremanEquipmentRes.status()).toBe(200);
  const foremanEquipment = readEquipmentItems(await foremanEquipmentRes.json());
  expect(foremanEquipment.some((item) => item.id === assignedEquipmentId)).toBe(true);
  expect(foremanEquipment.some((item) => item.id === unassignedEquipmentId)).toBe(false);

  await setRole(page, 'operator');
  const operatorAssignedEquipmentDetail = await page.request.get(`/api/equipment/${assignedEquipmentId}`);
  expect(operatorAssignedEquipmentDetail.status()).toBe(200);

  const operatorUnassignedEquipmentDetail = await page.request.get(`/api/equipment/${unassignedEquipmentId}`);
  expect(operatorUnassignedEquipmentDetail.status()).toBe(403);
  expect(await operatorUnassignedEquipmentDetail.json()).toEqual({ error: 'Forbidden' });

  await setRole(page, 'mechanic');
  const mechanicPatchRes = await page.request.patch(`/api/equipment/${assignedEquipmentId}`, {
    data: { status: 'maintenance' },
  });
  expect(mechanicPatchRes.status()).toBe(200);

  await setRole(page, 'pm');
  const pmCreateEquipmentRes = await page.request.post('/api/equipment', {
    data: { name: `e2e-pm-create-${stamp}`, status: 'active' },
  });
  expect(pmCreateEquipmentRes.status()).toBe(403);
  expect(await pmCreateEquipmentRes.json()).toEqual({ error: 'Forbidden' });

  const pmReadEquipmentRes = await page.request.get('/api/equipment');
  expect(pmReadEquipmentRes.status()).toBe(200);
});
