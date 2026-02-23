import { expect, test, type Page } from '@playwright/test';
import { getE2ECreds, loginViaUI } from './helpers';

type Role = 'admin' | 'pm' | 'foreman' | 'mechanic' | 'operator';
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

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

test('job detail financial summary is role-gated', async ({ page }) => {
  const { email } = getE2ECreds();
  await loginViaUI(page);
  await setRole(page, 'admin');

  const stamp = Date.now();

  const createJobResponse = await page.request.post('/api/jobs', {
    data: {
      name: `financial-summary-job-${stamp}`,
      status: 'in_progress',
      site_address: '123 Finance St',
      notes: 'financial summary e2e',
    },
  });
  const createJobBody = await createJobResponse.text();
  expect(createJobResponse.status(), createJobBody).toBe(200);
  const jobId = String(JSON.parse(createJobBody)?.job?.id ?? '');
  expect(jobId).toBeTruthy();

  const createBidResponse = await page.request.post('/api/bids', {
    data: {
      title: `Financial Bid ${stamp}`,
      status: 'draft',
      job_id: jobId,
    },
  });
  const createBidBody = await createBidResponse.text();
  expect(createBidResponse.status(), createBidBody).toBe(200);
  const bidId = String(JSON.parse(createBidBody)?.bid?.id ?? '');
  expect(bidId).toBeTruthy();

  const createBidItemResponse = await page.request.post(`/api/bids/${bidId}/items`, {
    data: { item_type: 'custom', description: 'Financial line', quantity: 1, unit_cost: 12500 },
  });
  const createBidItemBody = await createBidItemResponse.text();
  expect(createBidItemResponse.status(), createBidItemBody).toBe(200);

  const acceptBidResponse = await page.request.patch(`/api/bids/${bidId}`, {
    data: { status: 'accepted' },
  });
  const acceptBidBody = await acceptBidResponse.text();
  expect(acceptBidResponse.status(), acceptBidBody).toBe(200);

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
        name: `Financial Foreman ${stamp}`,
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

  const adminSummaryResponse = await page.request.get(`/api/jobs/${jobId}/financial-summary`);
  const adminSummaryBody = await adminSummaryResponse.text();
  expect(adminSummaryResponse.status(), adminSummaryBody).toBe(200);
  const adminSummary = JSON.parse(adminSummaryBody)?.item;
  expect(adminSummary?.visible).toBe(true);
  expect(Number(adminSummary?.contractValue ?? 0)).toBeGreaterThan(0);
  expect(Number(adminSummary?.revenueTotal ?? 0)).toBeGreaterThan(0);

  await page.goto('/');
  await page.getByTestId('nav-jobs').click();
  await page.getByTestId(`job-row-${jobId}`).click();
  await expect(page.getByText('Profitability')).toBeVisible();
  await expect(page.getByTestId('job-financial-hidden')).toHaveCount(0);
  await expect(page.getByText(currency.format(Number(adminSummary.contractValue)), { exact: false }).first()).toBeVisible();
  await expect(page.getByText(currency.format(Number(adminSummary.revenueTotal)), { exact: false }).first()).toBeVisible();

  await setRole(page, 'foreman');

  const foremanSummaryResponse = await page.request.get(`/api/jobs/${jobId}/financial-summary`);
  const foremanSummaryBody = await foremanSummaryResponse.text();
  expect(foremanSummaryResponse.status(), foremanSummaryBody).toBe(200);
  const foremanSummary = JSON.parse(foremanSummaryBody)?.item;
  expect(foremanSummary?.visible).toBe(false);
  expect(Number(foremanSummary?.contractValue ?? -1)).toBe(0);
  expect(Number(foremanSummary?.revenueTotal ?? -1)).toBe(0);

  await page.goto('/');
  await page.getByTestId('nav-jobs').click();
  await page.getByTestId(`job-row-${jobId}`).click();
  await expect(page.getByTestId('job-financial-hidden')).toBeVisible();
});
