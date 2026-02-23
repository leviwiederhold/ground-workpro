import { expect, test, type Page } from '@playwright/test';
import { loginViaUI } from './helpers';

type Role = 'admin' | 'pm' | 'foreman' | 'mechanic' | 'operator';

async function setRole(page: Page, role: Role) {
  const response = await page.request.post('/api/test/set-role', { data: { role } });
  const body = await response.text();
  expect(response.status(), body).toBe(200);
}

test('operator sees unread notification after admin assignment', async ({ page }) => {
  await loginViaUI(page);
  await setRole(page, 'admin');

  const stamp = Date.now();

  const jobResponse = await page.request.post('/api/jobs', {
    data: {
      name: `Notify Job ${stamp}`,
      status: 'in_progress',
      site_address: '100 Notify St',
    },
  });
  const jobBody = await jobResponse.text();
  expect(jobResponse.status(), jobBody).toBe(200);
  const jobId = JSON.parse(jobBody)?.job?.id;
  expect(jobId).toBeTruthy();

  const employeeResponse = await page.request.post('/api/employees', {
    data: {
      name: `Notify Operator ${stamp}`,
      role: 'Operator',
    },
  });
  const employeeBody = await employeeResponse.text();
  expect(employeeResponse.status(), employeeBody).toBe(200);
  const employeeId = JSON.parse(employeeBody)?.employee?.id;
  expect(employeeId).toBeTruthy();

  const date = new Date().toISOString().slice(0, 10);
  const assignmentResponse = await page.request.post('/api/schedule/assignments', {
    data: {
      jobId,
      date,
      employeeId,
    },
  });
  const assignmentBody = await assignmentResponse.text();
  expect(assignmentResponse.status(), assignmentBody).toBe(200);

  await setRole(page, 'operator');

  const notificationsResponse = await page.request.get('/api/notifications');
  const notificationsBody = await notificationsResponse.text();
  expect(notificationsResponse.status(), notificationsBody).toBe(200);
  const notifications = JSON.parse(notificationsBody)?.items ?? [];

  const unread = notifications.filter((item: { is_read: boolean }) => !item.is_read);
  expect(unread.length).toBeGreaterThan(0);

  const assignmentNotice = notifications.find(
    (item: { notification_type?: string; payload?: { jobId?: string } }) =>
      item.notification_type === 'assignment_created' && String(item.payload?.jobId) === String(jobId)
  );
  expect(Boolean(assignmentNotice)).toBe(true);
});
