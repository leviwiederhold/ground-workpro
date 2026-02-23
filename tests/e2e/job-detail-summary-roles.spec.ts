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

test('job detail summary is role-gated', async ({ page }) => {
  const { email } = getE2ECreds();
  await loginViaUI(page);
  await setRole(page, 'admin');

  const stamp = Date.now();

  const createJobResponse = await page.request.post('/api/jobs', {
    data: {
      name: `summary-role-job-${stamp}`,
      status: 'in_progress',
      site_address: '123 Summary Way',
      notes: 'Summary role test job',
    },
  });
  const createJobBody = await createJobResponse.text();
  expect(createJobResponse.status(), createJobBody).toBe(200);
  const jobId = JSON.parse(createJobBody)?.job?.id;
  expect(jobId).toBeTruthy();

  const employeesResponse = await page.request.get('/api/employees');
  const employeesBody = await employeesResponse.text();
  expect(employeesResponse.status(), employeesBody).toBe(200);
  const existingEmployee = (JSON.parse(employeesBody)?.employees || []).find(
    (employee: Record<string, unknown>) => String(employee.email ?? '').toLowerCase() === email.toLowerCase()
  );

  let employeeId = String(existingEmployee?.id ?? '');
  if (!employeeId) {
    const createEmployeeResponse = await page.request.post('/api/employees', {
      data: {
        name: `Summary Foreman ${stamp}`,
        role: 'Foreman',
        email,
      },
    });
    const createEmployeeBody = await createEmployeeResponse.text();
    expect(createEmployeeResponse.status(), createEmployeeBody).toBe(200);
    employeeId = String(JSON.parse(createEmployeeBody)?.employee?.id ?? '');
  }
  expect(employeeId).toBeTruthy();

  const assignResponse = await page.request.post(`/api/jobs/${jobId}/employees`, {
    data: { employee_id: employeeId },
  });
  expect([200, 409]).toContain(assignResponse.status());

  await page.goto('/');
  await page.getByTestId('nav-jobs').click();
  await page.getByTestId(`job-row-${jobId}`).click();

  await expect(page.getByText('Profitability')).toBeVisible();
  await expect(page.getByText('Revenue')).toBeVisible();
  await expect(page.getByText('Margin')).toBeVisible();

  await setRole(page, 'foreman');

  const summaryResponse = await page.request.get(`/api/jobs/${jobId}/summary`);
  const summaryBody = await summaryResponse.text();
  expect(summaryResponse.status(), summaryBody).toBe(200);
  const summary = JSON.parse(summaryBody);
  expect(summary?.item?.financial?.visible).toBe(false);

  await page.goto('/');
  await page.getByTestId('nav-jobs').click();
  await page.getByTestId(`job-row-${jobId}`).click();

  await expect(page.getByTestId('job-financial-hidden')).toBeVisible();
  await expect(page.getByText('Revenue')).toHaveCount(0);
});
