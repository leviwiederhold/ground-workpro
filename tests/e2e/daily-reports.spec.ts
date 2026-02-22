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

function readReportItems(json: unknown): Array<{ id: string; jobId: string | null }> {
  const payload = (json ?? {}) as {
    items?: unknown;
    dailyReports?: unknown;
    daily_reports?: unknown;
    reports?: unknown;
  };

  const rows = Array.isArray(payload.items)
    ? (payload.items as Array<Record<string, unknown>>)
    : Array.isArray(payload.dailyReports)
      ? (payload.dailyReports as Array<Record<string, unknown>>)
      : Array.isArray(payload.daily_reports)
        ? (payload.daily_reports as Array<Record<string, unknown>>)
        : Array.isArray(payload.reports)
          ? (payload.reports as Array<Record<string, unknown>>)
          : [];

  return rows.map((row) => ({
    id: String(row.id),
    jobId: row.jobId === null || row.jobId === undefined ? null : String(row.jobId),
  }));
}

test('daily report workflow is role scoped', async ({ page }) => {
  const { email } = getE2ECreds();
  const stamp = Date.now();

  await setRole(page, 'admin');

  const createAssignedJobRes = await page.request.post('/api/jobs', {
    data: { name: `e2e-dr-assigned-${stamp}`, status: 'in_progress' },
  });
  expect(createAssignedJobRes.status()).toBe(200);
  const assignedJobId = String((await createAssignedJobRes.json())?.job?.id ?? '');
  expect(assignedJobId).toBeTruthy();

  const createUnassignedJobRes = await page.request.post('/api/jobs', {
    data: { name: `e2e-dr-unassigned-${stamp}`, status: 'in_progress' },
  });
  expect(createUnassignedJobRes.status()).toBe(200);
  const unassignedJobId = String((await createUnassignedJobRes.json())?.job?.id ?? '');
  expect(unassignedJobId).toBeTruthy();

  const adminUnassignedReportRes = await page.request.post('/api/daily-reports', {
    data: {
      jobId: unassignedJobId,
      date: new Date().toISOString().slice(0, 10),
      weather: 'Sunny',
      crewSize: 1,
      notes: `admin-unassigned-${stamp}`,
      workAccomplished: 'admin created report',
    },
  });
  expect(adminUnassignedReportRes.status()).toBe(200);
  const adminUnassignedReportId = String((await adminUnassignedReportRes.json())?.dailyReport?.id ?? '');
  expect(adminUnassignedReportId).toBeTruthy();

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
        name: `E2E Daily Reports ${stamp}`,
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

  const operatorListBeforeRes = await page.request.get('/api/daily-reports');
  expect(operatorListBeforeRes.status()).toBe(200);
  const operatorListBefore = readReportItems(await operatorListBeforeRes.json());
  expect(operatorListBefore.some((row) => row.id === adminUnassignedReportId)).toBe(false);

  const operatorCreateRes = await page.request.post('/api/daily-reports', {
    data: {
      jobId: assignedJobId,
      date: new Date().toISOString().slice(0, 10),
      weather: 'Cloudy',
      crewSize: 2,
      notes: `operator-assigned-${stamp}`,
      workAccomplished: 'operator created report',
    },
  });
  expect(operatorCreateRes.status()).toBe(200);
  const operatorReportId = String((await operatorCreateRes.json())?.dailyReport?.id ?? '');
  expect(operatorReportId).toBeTruthy();

  const operatorDeleteRes = await page.request.delete(`/api/daily-reports/${operatorReportId}`);
  expect(operatorDeleteRes.status()).toBe(403);
  expect(await operatorDeleteRes.json()).toEqual({ error: 'Forbidden' });

  await setRole(page, 'admin');
  const adminListRes = await page.request.get('/api/daily-reports');
  expect(adminListRes.status()).toBe(200);
  const adminList = readReportItems(await adminListRes.json());
  expect(adminList.some((row) => row.id === operatorReportId)).toBe(true);
});
