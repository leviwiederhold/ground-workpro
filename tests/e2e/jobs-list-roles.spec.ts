import { expect, test, type Page } from '@playwright/test';
import { getE2ECreds, loginViaUI } from './helpers';

type Role = 'admin' | 'pm' | 'foreman' | 'mechanic' | 'operator';
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';

async function setRole(page: Page, role: Role) {
  let response = await page.request.post('/api/test/set-role', { data: { role } });
  let body = await response.text();
  if (response.status() === 403 && body.includes('No company membership found')) {
    await page.request.post('/api/bootstrap');
    response = await page.request.post('/api/test/set-role', { data: { role } });
    body = await response.text();
  }
  expect(response.status(), body).toBe(200);

  const payload = JSON.parse(body);
  expect(payload?.success).toBe(true);

  await page.context().addCookies([
    {
      name: 'e2e_role',
      value: role,
      url: BASE_URL,
    },
  ]);
}

async function openHomeWithRetry(page: Page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto('/');
    if (await page.getByTestId('nav-dashboard').isVisible().catch(() => false)) return;
    await page.reload();
  }
  await expect(page.getByTestId('nav-dashboard')).toBeVisible();
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

test('jobs list is role scoped and jobs nav visibility is correct', async ({ page }) => {
  const { email } = getE2ECreds();
  await loginViaUI(page);

  await setRole(page, 'admin');
  await openHomeWithRetry(page);

  await expect(page.getByTestId('nav-jobs')).toBeVisible();

  const stamp = Date.now();
  const assignedJobName = `e2e-jobs-list-assigned-${stamp}`;
  const unassignedJobName = `e2e-jobs-list-unassigned-${stamp}`;

  const createAssignedJobRes = await page.request.post('/api/jobs', {
    data: { name: assignedJobName, status: 'in_progress' },
  });
  expect(createAssignedJobRes.status()).toBe(200);
  const assignedJob = (await createAssignedJobRes.json())?.job;
  expect(assignedJob?.id).toBeTruthy();

  const createUnassignedJobRes = await page.request.post('/api/jobs', {
    data: { name: unassignedJobName, status: 'in_progress' },
  });
  expect(createUnassignedJobRes.status()).toBe(200);
  const unassignedJob = (await createUnassignedJobRes.json())?.job;
  expect(unassignedJob?.id).toBeTruthy();

  const adminJobsRes = await page.request.get('/api/jobs?limit=50');
  expect(adminJobsRes.status()).toBe(200);
  const adminJobs = readJobItems(await adminJobsRes.json());
  expect(adminJobs.some((job) => job.id === String(assignedJob.id))).toBe(true);
  expect(adminJobs.some((job) => job.id === String(unassignedJob.id))).toBe(true);

  const employeesRes = await page.request.get('/api/employees');
  expect(employeesRes.status()).toBe(200);
  const employeesJson = await employeesRes.json();
  const existingEmployee = (employeesJson?.employees ?? []).find(
    (employee: Record<string, unknown>) => String(employee.email ?? '').toLowerCase() === email.toLowerCase()
  );

  let employeeId = existingEmployee?.id as string | undefined;
  if (!employeeId) {
    const createEmployeeRes = await page.request.post('/api/employees', {
      data: {
        name: `E2E Foreman Employee ${stamp}`,
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
  const foremanJobsRes = await page.request.get('/api/jobs?limit=50');
  expect(foremanJobsRes.status()).toBe(200);
  const foremanJobs = readJobItems(await foremanJobsRes.json());
  expect(foremanJobs.some((job) => job.id === String(assignedJob.id))).toBe(true);
  expect(foremanJobs.some((job) => job.id === String(unassignedJob.id))).toBe(true);

  await setRole(page, 'operator');
  await openHomeWithRetry(page);
  await expect(page.getByTestId('nav-jobs')).toHaveCount(0);

  const blockedJobsRoute = await page.request.get('/jobs');
  expect(blockedJobsRoute.status()).toBe(403);
  expect(await blockedJobsRoute.json()).toEqual({ error: 'Forbidden' });

  const blockedJobsApi = await page.request.get('/api/jobs');
  expect(blockedJobsApi.status()).toBe(403);
  expect(await blockedJobsApi.json()).toEqual({ error: 'Forbidden' });
});
