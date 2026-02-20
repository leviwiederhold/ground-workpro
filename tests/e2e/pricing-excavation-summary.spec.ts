import { expect, type Page, test } from '@playwright/test';
import { loginViaUI } from './helpers';

async function setSubscriptionStatus(page: Page, subscriptionStatus: 'inactive' | 'active') {
  const response = await page.request.post('/api/test/set-subscription', {
    data: { subscription_status: subscriptionStatus },
  });
  expect(response.status()).toBe(200);
}

function expectNear(actual: number, expected: number, epsilon = 0.01) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(epsilon);
}

test('excavation summary includes hauling/dump/fuel breakdown and equipment warnings', async ({ page }) => {
  await loginViaUI(page);
  await setSubscriptionStatus(page, 'active');

  const pricingResp = await page.request.put('/api/pricing-settings', {
    data: {
      hauling_rate_per_hour: 120,
      dump_fee_per_load: 80,
      contingency_percent: 10,
      markup_percent: 10,
      target_margin_percent: 25,
    },
  });
  expect(pricingResp.status()).toBe(200);

  const bidCreateResp = await page.request.post('/api/bids', {
    data: { title: `E2E Excavation ${Date.now()}`, status: 'draft', bid_date: '2026-02-20' },
  });
  expect(bidCreateResp.status()).toBe(200);
  const bidCreateJson = await bidCreateResp.json();
  const bidId = bidCreateJson?.bid?.id;
  expect(bidId).toBeTruthy();

  const equipmentResp = await page.request.post('/api/equipment', {
    data: { name: `E2E Excavator ${Date.now()}`, type: 'Excavator', dailyRate: 0, status: 'active' },
  });
  expect(equipmentResp.status()).toBe(200);
  const equipmentJson = await equipmentResp.json();
  const equipmentId = equipmentJson?.equipment?.id;
  expect(equipmentId).toBeTruthy();

  const itemResp = await page.request.post(`/api/bids/${bidId}/items`, {
    data: {
      item_type: 'equipment',
      equipment_id: equipmentId,
      description: 'Excavator time',
      quantity: 5,
      unit_cost: 0,
    },
  });
  expect(itemResp.status()).toBe(200);

  const excavationResp = await page.request.patch(`/api/bids/${bidId}/excavation`, {
    data: {
      excavation_cy: 1000,
      production_cy_per_hour: 100,
      truck_capacity_cy: 20,
      cycle_time_minutes: 30,
      fuel_burn_gph: 8,
      fuel_cost_per_gallon: 4,
    },
  });
  expect(excavationResp.status()).toBe(200);

  const summaryResp = await page.request.get(`/api/bids/${bidId}/summary`);
  expect(summaryResp.status()).toBe(200);
  const summaryJson = await summaryResp.json();
  const summary = summaryJson?.summary;
  expect(summary).toBeTruthy();

  expectNear(Number(summary.itemizedCost), 0);
  expectNear(Number(summary.excavationHours), 10);
  expectNear(Number(summary.dumpLoads), 50);
  expectNear(Number(summary.haulingHours), 25);
  expectNear(Number(summary.haulingCost), 3000);
  expectNear(Number(summary.dumpCost), 4000);
  expectNear(Number(summary.fuelCost), 1120);
  expectNear(Number(summary.contingencyCost), 812);
  expectNear(Number(summary.subtotalCost), 8932);
  expectNear(Number(summary.revenue), 9825.2);
  expectNear(Number(summary.profit), 893.2);
  expectNear(Number(summary.marginPercent), 9.09);

  expect(Array.isArray(summary.warnings)).toBeTruthy();
  expect(summary.warnings.some((warning: string) => warning.includes('Missing equipment hourly rate'))).toBeTruthy();
  expect(summary.warnings.some((warning: string) => warning.includes('below target'))).toBeTruthy();
});
