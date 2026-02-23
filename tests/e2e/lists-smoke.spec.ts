import { expect, test } from '@playwright/test';
import { loginViaUI } from './helpers';

test('team/fleet/jobs lists render real rows', async ({ page }) => {
  await loginViaUI(page);

  const stamp = Date.now();
  const seededJobName = `e2e-list-job-${stamp}`;
  const seededEmployeeName = `e2e-list-employee-${stamp}`;
  const seededEquipmentName = `e2e-list-equipment-${stamp}`;

  const createJobRes = await page.request.post('/api/jobs', {
    data: { name: seededJobName, status: 'in_progress' },
  });
  expect(createJobRes.status()).toBe(200);

  const createEmployeeRes = await page.request.post('/api/employees', {
    data: { name: seededEmployeeName, role: 'Laborer' },
  });
  expect(createEmployeeRes.status()).toBe(200);

  const createEquipmentRes = await page.request.post('/api/equipment', {
    data: { name: seededEquipmentName, type: 'Equipment', status: 'active' },
  });
  expect(createEquipmentRes.status()).toBe(200);

  await page.goto('/');
  await page.getByTestId('nav-team').click();
  await expect(page.getByText(seededEmployeeName)).toBeVisible();

  await page.getByTestId('nav-fleet').click();
  await expect(page.getByText(seededEquipmentName)).toBeVisible();

  await page.getByTestId('nav-jobs').click();
  await expect(page.getByText(seededJobName)).toBeVisible();
});
