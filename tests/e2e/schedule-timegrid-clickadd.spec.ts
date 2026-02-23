import { expect, test, type Page } from '@playwright/test';
import { loginViaUI } from './helpers';

type Role = 'admin' | 'pm' | 'foreman' | 'mechanic' | 'operator';

async function setRole(page: Page, role: Role) {
  const response = await page.request.post('/api/test/set-role', { data: { role } });
  const body = await response.text();
  expect(response.status(), body).toBe(200);
}

test('schedule time-grid click-add persists and all-day assignment remains visible', async ({ page }) => {
  await loginViaUI(page);
  await setRole(page, 'admin');

  const stamp = Date.now();

  const jobResponse = await page.request.post('/api/jobs', {
    data: {
      name: `E2E TimeGrid Job ${stamp}`,
      status: 'in_progress',
      site_address: '123 Time Grid Way',
    },
  });
  const jobBody = await jobResponse.text();
  expect(jobResponse.status(), jobBody).toBe(200);
  const job = JSON.parse(jobBody).job;
  expect(job?.id).toBeTruthy();

  const employeeResponse = await page.request.post('/api/employees', {
    data: {
      name: `E2E Grid Employee ${stamp}`,
      role: 'Laborer',
    },
  });
  const employeeBody = await employeeResponse.text();
  expect(employeeResponse.status(), employeeBody).toBe(200);
  const employee = JSON.parse(employeeBody).employee;
  expect(employee?.id).toBeTruthy();

  const todayDateKey = new Date().toISOString().slice(0, 10);
  const allDayResponse = await page.request.post('/api/schedule/assignments', {
    data: {
      jobId: job.id,
      date: todayDateKey,
      employeeId: employee.id,
    },
  });
  const allDayBody = await allDayResponse.text();
  expect(allDayResponse.status(), allDayBody).toBe(200);
  const allDayAssignment = JSON.parse(allDayBody).item;
  expect(allDayAssignment?.id).toBeTruthy();

  await page.goto('/');
  await page.getByTestId('nav-schedule').click();

  await expect(page.getByText('1:00 PM').first()).toBeVisible({ timeout: 30_000 });

  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - now.getDay() + 1);
  const tuesday = new Date(monday);
  tuesday.setDate(monday.getDate() + 1);
  const tuesdayDateKey = tuesday.toISOString().slice(0, 10);

  const timeCell = page.getByTestId(`schedule-time-cell-${job.id}-${tuesdayDateKey}-13`);
  await expect(timeCell).toBeVisible({ timeout: 30_000 });
  await timeCell.click();

  const saveResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/schedule/assignments') &&
      response.request().method() === 'POST' &&
      (() => {
        const postData = response.request().postData();
        return typeof postData === 'string' && postData.includes('startsAt');
      })()
  );

  await page.getByTestId('schedule-quickadd-employee').selectOption(String(employee.id));
  await page.getByRole('button', { name: 'Save' }).click();

  const saved = await saveResponse;
  const savedBody = await saved.text();
  expect(saved.status(), savedBody).toBe(200);
  const timeAssignment = JSON.parse(savedBody).item;
  expect(timeAssignment?.id).toBeTruthy();

  await expect(page.getByTestId(`schedule-time-assignment-${timeAssignment.id}`)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId(`schedule-assignment-${allDayAssignment.id}`)).toBeVisible({ timeout: 30_000 });

  await page.reload();
  await page.getByTestId('nav-schedule').click();

  await expect(page.getByTestId(`schedule-time-assignment-${timeAssignment.id}`)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId(`schedule-assignment-${allDayAssignment.id}`)).toBeVisible({ timeout: 30_000 });
});
