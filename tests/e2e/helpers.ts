import { expect, type Page, type APIRequestContext } from '@playwright/test';
import { attachFailFast } from './helpers/attachFailFast';

export const E2E_BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';

export function getE2ECreds() {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;

  if (!email || !password || email === '...' || password === '...') {
    throw new Error(
      'Invalid E2E_EMAIL or E2E_PASSWORD. Use real login credentials (not "...") before running e2e tests.'
    );
  }

  return { email, password };
}

export async function loginViaUI(page: Page) {
  attachFailFast(page);
  const { email, password } = getE2ECreds();
  let bootstrapAttempted = false;
  const navProbeRequest = async () =>
    page.request.get('/api/nav', { timeout: 30_000 });

  await page.goto('/');
  try {
    const authProbe = await navProbeRequest();
    if (authProbe.ok()) {
      return;
    }
  } catch {
    // Continue through login flow if the initial probe times out.
  }

  await page.goto('/login');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);

  await page.getByTestId('login-submit').click();

  await expect
    .poll(
      async () => {
        const loginError = page.getByTestId('login-error');
        if (await loginError.isVisible().catch(() => false)) {
          const message = (await loginError.textContent())?.trim() || 'Unknown login error';
          throw new Error(`E2E login failed: ${message}`);
        }

        let navProbe;
        try {
          navProbe = await navProbeRequest();
          if (navProbe.ok()) {
            return true;
          }
        } catch {
          return false;
        }

        if (!bootstrapAttempted && navProbe.status() === 403) {
          const body = (await navProbe.text().catch(() => '')).toLowerCase();
          if (body.includes('no company membership found')) {
            bootstrapAttempted = true;
            await page.request.post('/api/bootstrap');
          }
        }

        if (!page.url().includes('/login')) {
          return true;
        }

        const appShellVisible = await page.getByText('GROUNDWORK', { exact: false }).isVisible().catch(() => false);
        if (appShellVisible && !page.url().includes('/login')) {
          return true;
        }
        return false;
      },
      { timeout: 30_000, message: 'E2E login failed: app did not complete auth flow.' }
    )
    .toBe(true);

  await page.goto('/');
  await expect
    .poll(async () => {
      try {
        const navProbe = await navProbeRequest();
        return navProbe.ok();
      } catch {
        return false;
      }
    }, { timeout: 30_000 })
    .toBe(true);
}

type JobCostingSeed = {
  jobId: string;
  bidId: string;
  reportId: string;
  poId: string;
};

export async function seedJobCostingFixture(
  request: APIRequestContext,
  timestamp: number
): Promise<JobCostingSeed> {
  const jobName = `Costing Job ${timestamp}`;
  const vendorName = `Costing Vendor ${timestamp}`;

  const createJobResponse = await request.post('/api/jobs', {
    data: { name: jobName, status: 'draft' },
  });
  expect(createJobResponse.status()).toBe(200);
  const createJobJson = await createJobResponse.json();
  const jobId = createJobJson?.job?.id;
  expect(jobId).toBeTruthy();

  const createBidResponse = await request.post('/api/bids', {
    data: { title: `Bid ${timestamp}`, status: 'draft', job_id: jobId },
  });
  expect(createBidResponse.status()).toBe(200);
  const createBidJson = await createBidResponse.json();
  const bidId = createBidJson?.bid?.id;
  expect(bidId).toBeTruthy();

  const createBidItemResponse = await request.post(`/api/bids/${bidId}/items`, {
    data: { item_type: 'custom', description: 'Estimate baseline', quantity: 1, unit_cost: 100 },
  });
  expect(createBidItemResponse.status()).toBe(200);

  const createReportResponse = await request.post('/api/daily-reports', {
    data: {
      jobId,
      date: new Date().toISOString().slice(0, 10),
      weather: 'Clear',
      tempHigh: 65,
      tempLow: 48,
      crewSize: 1,
      workAccomplished: 'Costing test',
      notes: 'Costing test',
    },
  });
  expect(createReportResponse.status()).toBe(200);
  const createReportJson = await createReportResponse.json();
  const reportId = createReportJson?.dailyReport?.id;
  expect(reportId).toBeTruthy();

  // Material quantity is used as direct cost proxy when unit cost columns are absent.
  const createEntryResponse = await request.post(`/api/daily-reports/${reportId}/entries`, {
    data: { entry_type: 'material', description: 'Imported fill', quantity: 200 },
  });
  expect(createEntryResponse.status()).toBe(200);

  const createVendorResponse = await request.post('/api/vendors', {
    data: { name: vendorName, status: 'active' },
  });
  expect(createVendorResponse.status()).toBe(200);
  const createVendorJson = await createVendorResponse.json();
  const vendorId = createVendorJson?.vendor?.id;
  expect(vendorId).toBeTruthy();

  const createPoResponse = await request.post('/api/purchase-orders', {
    data: { vendor_id: vendorId, job_id: jobId, status: 'draft', notes: 'Costing PO' },
  });
  expect(createPoResponse.status()).toBe(200);
  const createPoJson = await createPoResponse.json();
  const poId = createPoJson?.purchase_order?.id;
  expect(poId).toBeTruthy();

  const createPoItemResponse = await request.post(`/api/purchase-orders/${poId}/items`, {
    data: { description: 'PO cost', quantity: 1, unit_cost: 25 },
  });
  expect(createPoItemResponse.status()).toBe(200);

  return {
    jobId: String(jobId),
    bidId: String(bidId),
    reportId: String(reportId),
    poId: String(poId),
  };
}
