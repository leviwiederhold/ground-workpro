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

test('admin can assign employee to job from team page', async ({ page }) => {
  await loginViaUI(page);
  await setRole(page, 'admin');

  const stamp = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  const createJobRes = await page.request.post('/api/jobs', {
    data: { name: `team-assign-job-${stamp}`, status: 'in_progress' },
  });
  expect(createJobRes.status()).toBe(200);
  const jobId = String((await createJobRes.json())?.job?.id ?? '');
  expect(jobId).toBeTruthy();

  const createEmployeeRes = await page.request.post('/api/employees', {
    data: {
      name: `Team Assign Employee ${stamp}`,
      role: 'Operator',
      email: `team-assign-${stamp}@example.com`,
    },
  });
  const createEmployeeBody = await createEmployeeRes.text();
  expect(createEmployeeRes.status(), createEmployeeBody).toBe(200);
  const employeeId = String(JSON.parse(createEmployeeBody)?.employee?.id ?? '');
  expect(employeeId).toBeTruthy();

  await page.goto('/team');
  await expect(page.getByText(`Team Assign Employee ${stamp}`)).toBeVisible();

  await page.getByTestId(`team-assign-${employeeId}`).click();
  await page.getByTestId('team-assign-job').selectOption(jobId);
  await page.getByTestId('team-assign-date').fill(today);
  await page.getByTestId('team-assign-notes').fill('assigned from team e2e');
  await page.getByTestId('team-assign-submit').click();

  await expect(page.getByText(`team-assign-job-${stamp}`)).toBeVisible();

  await page.reload();
  await expect(page.getByText(`Team Assign Employee ${stamp}`)).toBeVisible();
  await expect(page.getByText(`team-assign-job-${stamp}`)).toBeVisible();
});
