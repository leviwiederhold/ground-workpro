import { expect, test, type Page } from '@playwright/test';
import { loginViaUI } from './helpers';

type Role = 'admin' | 'pm' | 'foreman' | 'mechanic' | 'operator';

async function setRole(page: Page, role: Role) {
  const response = await page.request.post('/api/test/set-role', { data: { role } });
  const body = await response.text();
  expect(response.status(), body).toBe(200);
}

test('schedule shows warning when employee is double-booked', async ({ page }) => {
  await loginViaUI(page);
  await setRole(page, 'admin');

  const stamp = Date.now();
  const date = new Date().toISOString().slice(0, 10);

  const [jobARes, jobBRes, employeeRes] = await Promise.all([
    page.request.post('/api/jobs', {
      data: { name: `Conflict Job A ${stamp}`, status: 'in_progress', site_address: 'A St' },
    }),
    page.request.post('/api/jobs', {
      data: { name: `Conflict Job B ${stamp}`, status: 'in_progress', site_address: 'B St' },
    }),
    page.request.post('/api/employees', {
      data: { name: `Conflict Employee ${stamp}`, role: 'Laborer' },
    }),
  ]);

  const jobABody = await jobARes.text();
  const jobBBody = await jobBRes.text();
  const employeeBody = await employeeRes.text();

  expect(jobARes.status(), jobABody).toBe(200);
  expect(jobBRes.status(), jobBBody).toBe(200);
  expect(employeeRes.status(), employeeBody).toBe(200);

  const jobAId = JSON.parse(jobABody)?.job?.id;
  const jobBId = JSON.parse(jobBBody)?.job?.id;
  const employeeId = JSON.parse(employeeBody)?.employee?.id;

  const assignmentRes = await page.request.post('/api/schedule/assignments', {
    data: {
      jobId: jobAId,
      date,
      employeeId,
    },
  });
  expect(assignmentRes.status(), await assignmentRes.text()).toBe(200);

  await page.goto('/');
  await page.getByTestId('nav-schedule').click();

  const source = page.getByTestId(`schedule-resource-employee-${employeeId}`);
  const target = page.getByTestId(`schedule-slot-${jobBId}-${date}`);

  await expect(source).toBeVisible({ timeout: 30_000 });
  await expect(target).toBeVisible({ timeout: 30_000 });

  await source.dragTo(target);

  await expect(page.getByTestId('schedule-conflict-warning')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('schedule-conflict-warning')).toContainText('already assigned');
});
