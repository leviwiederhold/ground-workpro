import { expect, test, type Page } from '@playwright/test';
import { loginViaUI } from './helpers';

type Role = 'admin' | 'pm' | 'foreman' | 'mechanic' | 'operator';

async function setRole(page: Page, role: Role) {
  const response = await page.request.post('/api/test/set-role', { data: { role } });
  const body = await response.text();
  expect(response.status(), body).toBe(200);
}

test('schedule assignments persist after refresh', async ({ page }) => {
  await loginViaUI(page);
  await setRole(page, 'admin');

  const stamp = Date.now();

  const jobResponse = await page.request.post('/api/jobs', {
    data: {
      name: `E2E Schedule Job ${stamp}`,
      status: 'in_progress',
      site_address: '123 Assignments Way',
    },
  });
  const jobBody = await jobResponse.text();
  expect(jobResponse.status(), jobBody).toBe(200);
  const job = JSON.parse(jobBody).job;
  expect(job?.id).toBeTruthy();

  const employeeResponse = await page.request.post('/api/employees', {
    data: {
      name: `E2E Scheduler ${stamp}`,
      role: 'Laborer',
    },
  });
  const employeeBody = await employeeResponse.text();
  expect(employeeResponse.status(), employeeBody).toBe(200);
  const employee = JSON.parse(employeeBody).employee;
  expect(employee?.id).toBeTruthy();

  const equipmentResponse = await page.request.post('/api/equipment', {
    data: {
      name: `E2E Equipment ${stamp}`,
      status: 'active',
      type: 'Truck',
    },
  });
  const equipmentBody = await equipmentResponse.text();
  expect(equipmentResponse.status(), equipmentBody).toBe(200);

  await page.goto('/');
  await page.getByTestId('nav-schedule').click();

  const dateKey = new Date().toISOString().slice(0, 10);
  const sourceEmployee = page.getByTestId(`schedule-resource-employee-${employee.id}`);
  const targetSlot = page.getByTestId(`schedule-slot-${job.id}-${dateKey}`);

  await expect(sourceEmployee).toBeVisible({ timeout: 30_000 });
  await expect(targetSlot).toBeVisible({ timeout: 30_000 });

  const createAssignmentResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/schedule/assignments') &&
      response.request().method() === 'POST'
  );

  await sourceEmployee.dragTo(targetSlot);

  const created = await createAssignmentResponse;
  const createdBody = await created.text();
  expect(created.status(), createdBody).toBe(200);

  await expect(targetSlot.getByText(employee.name)).toBeVisible({ timeout: 30_000 });

  await page.reload();
  await page.getByTestId('nav-schedule').click();

  const weekResponse = await page.request.get(`/api/schedule/week?start=${dateKey}`);
  const weekBody = await weekResponse.text();
  expect(weekResponse.status(), weekBody).toBe(200);
  const weekJson = JSON.parse(weekBody);

  const assignmentsForDate = (weekJson.items || [])
    .find((entry: { date: string }) => entry.date === dateKey)?.assignments || [];

  const persisted = assignmentsForDate.find(
    (assignment: { jobId: string; employeeId: string | null }) =>
      String(assignment.jobId) === String(job.id) && String(assignment.employeeId) === String(employee.id)
  );
  expect(Boolean(persisted)).toBe(true);
  await expect(page.getByTestId(`schedule-slot-${job.id}-${dateKey}`).getByText(employee.name)).toBeVisible({ timeout: 30_000 });
});
