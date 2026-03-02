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

test('team list includes derived assignment/hours and role-gated pay', async ({ page }) => {
  await loginViaUI(page);
  await setRole(page, 'admin');

  const stamp = Date.now();

  const createJobRes = await page.request.post('/api/jobs', {
    data: { name: `team-derived-job-${stamp}`, status: 'in_progress' },
  });
  expect(createJobRes.status()).toBe(200);
  const jobId = String((await createJobRes.json())?.job?.id ?? '');
  expect(jobId).toBeTruthy();

  const createEmployeeRes = await page.request.post('/api/employees', {
    data: {
      name: `Team Operator ${stamp}`,
      role: 'Operator',
      hourlyRate: 42,
      email: `team-operator-${stamp}@example.com`,
    },
  });
  const createEmployeeBody = await createEmployeeRes.text();
  expect(createEmployeeRes.status(), createEmployeeBody).toBe(200);
  const employeeId = String(JSON.parse(createEmployeeBody)?.employee?.id ?? '');
  expect(employeeId).toBeTruthy();

  const assignRes = await page.request.post('/api/schedule/assignments', {
    data: {
      jobId,
      date: new Date().toISOString().slice(0, 10),
      employeeId,
      notes: 'team derived e2e',
    },
  });
  expect([200, 409]).toContain(assignRes.status());

  const adminTeamRes = await page.request.get('/api/team?limit=50');
  const adminTeamJson = await adminTeamRes.json();
  expect(adminTeamRes.status()).toBe(200);
  const adminItems = Array.isArray(adminTeamJson?.items) ? adminTeamJson.items : [];
  const seededAdminRow = adminItems.find((item: Record<string, unknown>) => String(item.id) === employeeId);
  expect(seededAdminRow).toBeTruthy();
  expect(String((seededAdminRow as Record<string, unknown>).assignedToday ? 'yes' : 'no')).toBe('yes');
  expect(String(((seededAdminRow as Record<string, unknown>).assignedToday as Record<string, unknown>)?.jobId ?? '')).toBe(jobId);
  expect(Number((seededAdminRow as Record<string, unknown>).hoursThisWeek ?? -1)).toBe(0);
  expect(Boolean(((seededAdminRow as Record<string, unknown>).pay as Record<string, unknown>)?.visible)).toBe(true);

  await page.goto('/team');

  await setRole(page, 'operator');
  const operatorTeamRes = await page.request.get('/api/team?limit=50');
  const operatorTeamJson = await operatorTeamRes.json();
  expect(operatorTeamRes.status()).toBe(200);
  const operatorItems = Array.isArray(operatorTeamJson?.items) ? operatorTeamJson.items : [];
  expect(operatorItems.length).toBeGreaterThan(0);
  for (const item of operatorItems) {
    const pay = (item as Record<string, unknown>).pay as Record<string, unknown>;
    expect(Boolean(pay?.visible)).toBe(false);
    expect(Number(pay?.hourlyRate ?? -1)).toBe(0);
    expect(Number(pay?.loadedHourlyCost ?? -1)).toBe(0);
  }
});
