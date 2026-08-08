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

test('job detail actions are role scoped', async ({ page }) => {
  const { email } = getE2ECreds();
  const stamp = Date.now();

  await setRole(page, 'admin');

  const createAssignedJobRes = await page.request.post('/api/jobs', {
    // Keep this fixture inactive so assigning the shared E2E employee does not
    // depend on creating a second active-job assignment.
    data: { name: `e2e-role-assigned-${stamp}`, status: 'draft' },
  });
  expect(createAssignedJobRes.status()).toBe(200);
  const assignedJobId = (await createAssignedJobRes.json())?.job?.id as string;
  expect(assignedJobId).toBeTruthy();

  const createUnassignedJobRes = await page.request.post('/api/jobs', {
    data: { name: `e2e-role-unassigned-${stamp}`, status: 'in_progress' },
  });
  expect(createUnassignedJobRes.status()).toBe(200);
  const unassignedJobId = (await createUnassignedJobRes.json())?.job?.id as string;
  expect(unassignedJobId).toBeTruthy();

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
        name: `E2E Job Detail ${stamp}`,
        role: 'Operator',
        email,
      },
    });
    expect(createEmployeeRes.status()).toBe(200);
    employeeId = String((await createEmployeeRes.json())?.employee?.id ?? '');
  }
  expect(employeeId).toBeTruthy();

  const assignRes = await page.request.post(`/api/jobs/${assignedJobId}/employees`, {
    data: { employee_id: employeeId },
  });
  expect([200, 409]).toContain(assignRes.status());

  await setRole(page, 'operator');
  const operatorAssignedDetail = await page.request.get(`/api/jobs/${assignedJobId}`);
  expect(operatorAssignedDetail.status()).toBe(200);

  const operatorUnassignedDetail = await page.request.get(`/api/jobs/${unassignedJobId}`);
  expect(operatorUnassignedDetail.status()).toBe(403);
  expect(await operatorUnassignedDetail.json()).toEqual({ error: 'Forbidden' });

  const operatorPatch = await page.request.patch(`/api/jobs/${assignedJobId}`, {
    data: { name: `operator-edit-${stamp}` },
  });
  expect(operatorPatch.status()).toBe(403);
  expect(await operatorPatch.json()).toEqual({ error: 'Forbidden' });

  await setRole(page, 'foreman');
  const foremanDailyReport = await page.request.post('/api/daily-reports', {
    data: {
      jobId: assignedJobId,
      date: new Date().toISOString().slice(0, 10),
      notes: `Foreman note ${stamp}`,
      weather: 'Clear',
      crewSize: 2,
      workAccomplished: 'Role test daily report',
    },
  });
  expect(foremanDailyReport.status()).toBe(200);
  const foremanReportPayload = (await foremanDailyReport.json()) as { dailyReport?: { id?: string; jobId?: string } };
  expect(foremanReportPayload.dailyReport?.id).toBeTruthy();
  expect(String(foremanReportPayload.dailyReport?.jobId ?? '')).toBe(String(assignedJobId));

  await setRole(page, 'pm');
  const pmPatch = await page.request.patch(`/api/jobs/${assignedJobId}`, {
    data: { name: `pm-edited-${stamp}`, status: 'completed' },
  });
  expect(pmPatch.status()).toBe(200);
  const pmPatchPayload = (await pmPatch.json()) as { job?: { name?: string; status?: string } };
  expect(pmPatchPayload.job?.name).toBe(`pm-edited-${stamp}`);
  expect(pmPatchPayload.job?.status).toBe('completed');
});
