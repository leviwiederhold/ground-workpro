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

function readJobItems(json: unknown): Array<{ id: string; name: string }> {
  const payload = (json ?? {}) as { items?: unknown; jobs?: unknown };
  const rows = Array.isArray(payload.items)
    ? (payload.items as Array<Record<string, unknown>>)
    : Array.isArray(payload.jobs)
      ? (payload.jobs as Array<Record<string, unknown>>)
      : [];
  return rows.map((row) => ({ id: String(row.id), name: String(row.name ?? '') }));
}

test('jobs list and detail are role scoped', async ({ page }) => {
  const { email } = getE2ECreds();

  await setRole(page, 'admin');

  const stamp = Date.now();
  const assignedJobName = `e2e-assigned-job-${stamp}`;
  const unassignedJobName = `e2e-unassigned-job-${stamp}`;

  const createAssignedJob = await page.request.post('/api/jobs', {
    data: { name: assignedJobName, status: 'in_progress' },
  });
  expect(createAssignedJob.status()).toBe(200);
  const assignedJob = (await createAssignedJob.json())?.job;
  expect(assignedJob?.id).toBeTruthy();

  const createUnassignedJob = await page.request.post('/api/jobs', {
    data: { name: unassignedJobName, status: 'in_progress' },
  });
  expect(createUnassignedJob.status()).toBe(200);
  const unassignedJob = (await createUnassignedJob.json())?.job;
  expect(unassignedJob?.id).toBeTruthy();

  const adminJobsRes = await page.request.get('/api/jobs');
  expect(adminJobsRes.status()).toBe(200);
  const adminJobs = readJobItems(await adminJobsRes.json());
  expect(adminJobs.length).toBeGreaterThan(1);
  expect(adminJobs.some((job) => job.id === String(assignedJob.id))).toBe(true);
  expect(adminJobs.some((job) => job.id === String(unassignedJob.id))).toBe(true);

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
        name: `E2E Role Employee ${stamp}`,
        role: 'Foreman',
        email,
      },
    });
    expect(createEmployeeRes.status()).toBe(200);
    employeeId = (await createEmployeeRes.json())?.employee?.id;
  }

  expect(employeeId).toBeTruthy();

  const assignRes = await page.request.post(`/api/jobs/${assignedJob.id}/employees`, {
    data: { employee_id: employeeId },
  });
  expect([200, 409]).toContain(assignRes.status());

  await setRole(page, 'foreman');
  const foremanJobsRes = await page.request.get('/api/jobs');
  expect(foremanJobsRes.status()).toBe(200);
  const foremanJobs = readJobItems(await foremanJobsRes.json());
  expect(foremanJobs.some((job) => job.id === String(assignedJob.id))).toBe(true);
  expect(foremanJobs.some((job) => job.id === String(unassignedJob.id))).toBe(true);

  const foremanUnassignedDetail = await page.request.get(`/api/jobs/${unassignedJob.id}`);
  expect(foremanUnassignedDetail.status()).toBe(200);

  await setRole(page, 'operator');
  const operatorUnassignedDetail = await page.request.get(`/api/jobs/${unassignedJob.id}`);
  expect(operatorUnassignedDetail.status()).toBe(403);
  expect(await operatorUnassignedDetail.json()).toEqual({ error: 'Forbidden' });
});
