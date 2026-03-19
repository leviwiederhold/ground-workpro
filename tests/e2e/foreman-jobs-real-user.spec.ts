import { expect, test, type Page } from '@playwright/test';
import { loginViaUI } from './helpers';

async function setRole(page: Page, role: 'admin' | 'pm' | 'foreman' | 'mechanic' | 'operator') {
  const response = await page.request.post('/api/test/set-role', { data: { role } });
  const body = await response.text();
  expect(response.status(), body).toBe(200);
}

function readJobItems(json: unknown): Array<{ id: string; name: string }> {
  const payload = (json ?? {}) as { items?: unknown; jobs?: unknown };
  const rows = Array.isArray(payload.items)
    ? (payload.items as Array<Record<string, unknown>>)
    : Array.isArray(payload.jobs)
      ? (payload.jobs as Array<Record<string, unknown>>)
      : [];
  return rows.map((row) => ({ id: String(row.id ?? ''), name: String(row.name ?? '') }));
}

test('real invited foreman with jobs access sees company jobs', async ({ page }) => {
  await loginViaUI(page);
  await setRole(page, 'admin');

  const stamp = Date.now();
  const email = `foreman-jobs-${stamp}@example.com`;
  const password = `ForemanPass!${stamp}`;

  const employeeResponse = await page.request.post('/api/employees', {
    data: {
      name: `Foreman ${stamp}`,
      role: 'Foreman',
      email,
    },
  });
  const employeeBody = await employeeResponse.text();
  expect(employeeResponse.status(), employeeBody).toBe(200);
  const employeeId = String(JSON.parse(employeeBody)?.employee?.id ?? '');
  expect(employeeId).toBeTruthy();

  const inviteResponse = await page.request.post('/api/invite/create', {
    data: {
      employeeId,
      email,
      role: 'foreman',
    },
  });
  const inviteBody = await inviteResponse.text();
  expect(inviteResponse.status(), inviteBody).toBe(200);
  const inviteToken = String(JSON.parse(inviteBody)?.item?.token ?? '');
  expect(inviteToken.length).toBeGreaterThanOrEqual(20);

  const acceptResponse = await page.request.post('/api/test/accept-invite', {
    data: {
      token: inviteToken,
      email,
      password,
    },
  });
  expect(acceptResponse.status(), await acceptResponse.text()).toBe(200);

  const assignedJobResponse = await page.request.post('/api/jobs', {
    data: { name: `Foreman Assigned ${stamp}`, status: 'in_progress' },
  });
  const unassignedJobResponse = await page.request.post('/api/jobs', {
    data: { name: `Foreman Unassigned ${stamp}`, status: 'in_progress' },
  });
  expect(assignedJobResponse.status()).toBe(200);
  expect(unassignedJobResponse.status()).toBe(200);
  const assignedJob = (await assignedJobResponse.json())?.job;
  const unassignedJob = (await unassignedJobResponse.json())?.job;
  expect(assignedJob?.id).toBeTruthy();
  expect(unassignedJob?.id).toBeTruthy();

  const assignResponse = await page.request.post(`/api/jobs/${assignedJob.id}/employees`, {
    data: { employee_id: employeeId },
  });
  expect([200, 409]).toContain(assignResponse.status());

  const loginResponse = await page.request.post('/api/test/login', {
    data: {
      email,
      password,
    },
  });
  expect(loginResponse.status(), await loginResponse.text()).toBe(200);
  await setRole(page, 'foreman');

  const navResponse = await page.request.get('/api/nav');
  const navBody = await navResponse.text();
  expect(navResponse.status(), navBody).toBe(200);
  const navItems = JSON.parse(navBody)?.items ?? [];
  expect(navItems.some((item: { key?: string }) => String(item.key ?? '') === 'jobs')).toBe(true);

  const jobsResponse = await page.request.get('/api/jobs?limit=50');
  const jobsBody = await jobsResponse.text();
  expect(jobsResponse.status(), jobsBody).toBe(200);
  const jobs = readJobItems(JSON.parse(jobsBody));
  expect(jobs.some((job) => job.id === String(assignedJob.id))).toBe(true);
  expect(jobs.some((job) => job.id === String(unassignedJob.id))).toBe(true);
});
