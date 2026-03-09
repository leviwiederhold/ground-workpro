import { expect, test, type Page } from '@playwright/test';
import { getE2ECreds, loginViaUI } from './helpers';

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

test('safety log actions are role scoped', async ({ page }) => {
  const { email } = getE2ECreds();
  const stamp = Date.now();
  await loginViaUI(page);

  await setRole(page, 'admin');

  const createJobRes = await page.request.post('/api/jobs', {
    data: { name: `e2e-safety-job-${stamp}`, status: 'in_progress' },
  });
  expect(createJobRes.status()).toBe(200);
  const jobId = String((await createJobRes.json())?.job?.id ?? '');
  expect(jobId).toBeTruthy();

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
        name: `E2E Safety Employee ${stamp}`,
        role: 'Operator',
        email,
      },
    });
    expect(createEmployeeRes.status()).toBe(200);
    employeeId = String((await createEmployeeRes.json())?.employee?.id ?? '');
  }
  expect(employeeId).toBeTruthy();

  const assignRes = await page.request.post(`/api/jobs/${jobId}/employees`, {
    data: { employee_id: employeeId },
  });
  expect([200, 409]).toContain(assignRes.status());

  await setRole(page, 'operator');

  const createSafetyRes = await page.request.post('/api/safety-logs', {
    data: {
      occurred_on: new Date().toISOString().slice(0, 10),
      summary: `Operator safety ${stamp}`,
      severity: 'medium',
      job_id: jobId,
    },
  });
  expect(createSafetyRes.status()).toBe(201);
  const createdSafety = (await createSafetyRes.json()) as { item?: { id?: string } };
  const safetyId = String(createdSafety.item?.id ?? '');
  expect(safetyId).toBeTruthy();

  const operatorDelete = await page.request.delete(`/api/safety-logs/${safetyId}`, { timeout: 30_000 });
  expect(operatorDelete.status()).toBe(403);
  expect(await operatorDelete.json()).toEqual({ error: 'Forbidden' });

  await setRole(page, 'admin');

  const adminDelete = await page.request.delete(`/api/safety-logs/${safetyId}`, { timeout: 30_000 });
  expect(adminDelete.status()).toBe(200);
  expect(await adminDelete.json()).toEqual({ success: true });
});
