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
  const today = new Date().toISOString().slice(0, 10);

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
  const equipment = JSON.parse(equipmentBody).equipment;
  expect(equipment?.id).toBeTruthy();

  await page.goto('/');
  await page.getByTestId('nav-schedule').click();

  const createEmployeeAssignment = await page.request.post('/api/schedule/assignments', {
    data: {
      jobId: job.id,
      date: today,
      employeeId: employee.id,
      notes: 'employee assignment from e2e',
    },
  });
  const createEmployeeAssignmentBody = await createEmployeeAssignment.text();
  expect(createEmployeeAssignment.status(), createEmployeeAssignmentBody).toBe(200);
  const createdEmployeeAssignment = JSON.parse(createEmployeeAssignmentBody)?.item;
  expect(createdEmployeeAssignment?.id).toBeTruthy();

  const createEquipmentAssignment = await page.request.post('/api/schedule/assignments', {
    data: {
      jobId: job.id,
      date: today,
      equipmentId: equipment.id,
      notes: 'equipment assignment from e2e',
    },
  });
  const createEquipmentAssignmentBody = await createEquipmentAssignment.text();
  expect(createEquipmentAssignment.status(), createEquipmentAssignmentBody).toBe(200);
  const createdEquipmentAssignment = JSON.parse(createEquipmentAssignmentBody)?.item;
  expect(createdEquipmentAssignment?.id).toBeTruthy();

  await page.reload();
  await page.getByTestId('nav-schedule').click();

  const weekResponseAfterReload = await page.request.get(`/api/schedule/week?start=${today}`);
  const weekBodyAfterReload = await weekResponseAfterReload.text();
  expect(weekResponseAfterReload.status(), weekBodyAfterReload).toBe(200);

  const teamResponse = await page.request.get('/api/team');
  const teamBody = await teamResponse.text();
  expect(teamResponse.status(), teamBody).toBe(200);
  const teamPayload = JSON.parse(teamBody);
  const assignedEmployee = (teamPayload.items || []).find(
    (item: { id?: string; assignedToday?: { jobId?: string } | null }) =>
      String(item.id ?? '') === String(employee.id) &&
      String(item.assignedToday?.jobId ?? '') === String(job.id)
  );
  expect(Boolean(assignedEmployee)).toBe(true);
});
