import { expect, test, type Page } from '@playwright/test';
import { loginViaUI } from './helpers';

type Role = 'admin' | 'pm' | 'foreman' | 'mechanic' | 'operator';

async function setRole(page: Page, role: Role) {
  const response = await page.request.post('/api/test/set-role', { data: { role } });
  const body = await response.text();
  expect(response.status(), body).toBe(200);
}

test('notifications are created for schedule assignment and unread count decreases on read', async ({ page }) => {
  await loginViaUI(page);
  await setRole(page, 'admin');

  const stamp = Date.now();
  const date = new Date().toISOString().slice(0, 10);

  const jobResponse = await page.request.post('/api/jobs', {
    data: {
      name: `E2E Notify Job ${stamp}`,
      status: 'in_progress',
      site_address: '123 Notification Way',
    },
  });
  const jobBody = await jobResponse.text();
  expect(jobResponse.status(), jobBody).toBe(200);
  const jobId = JSON.parse(jobBody)?.job?.id;
  expect(jobId).toBeTruthy();

  const employeeResponse = await page.request.post('/api/employees', {
    data: {
      name: `E2E Notify Employee ${stamp}`,
      role: 'Operator',
      email: 'notify@example.com',
    },
  });
  const employeeBody = await employeeResponse.text();
  expect(employeeResponse.status(), employeeBody).toBe(200);
  const employeeId = JSON.parse(employeeBody)?.employee?.id;
  expect(employeeId).toBeTruthy();

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

  const unreadBeforeRes = await page.request.get('/api/notifications/unread-count');
  const unreadBeforeBody = await unreadBeforeRes.text();
  expect(unreadBeforeRes.status(), unreadBeforeBody).toBe(200);
  const unreadBefore = Number(JSON.parse(unreadBeforeBody)?.item?.count ?? 0);
  expect(unreadBefore).toBeGreaterThan(0);

  const listRes = await page.request.get('/api/notifications?limit=20');
  const listBody = await listRes.text();
  expect(listRes.status(), listBody).toBe(200);
  const list = JSON.parse(listBody)?.items ?? [];

  const unreadNotification = list.find((item: { readAt?: string | null; read_at?: string | null }) =>
    !item.readAt && !item.read_at
  );
  expect(unreadNotification?.id).toBeTruthy();

  const readRes = await page.request.post(`/api/notifications/${unreadNotification.id}/read`);
  const readBody = await readRes.text();
  expect(readRes.status(), readBody).toBe(200);

  const unreadAfterRes = await page.request.get('/api/notifications/unread-count');
  const unreadAfterBody = await unreadAfterRes.text();
  expect(unreadAfterRes.status(), unreadAfterBody).toBe(200);
  const unreadAfter = Number(JSON.parse(unreadAfterBody)?.item?.count ?? 0);

  expect(unreadAfter).toBeLessThan(unreadBefore);

  const markAllRes = await page.request.post('/api/notifications/read-all');
  const markAllBody = await markAllRes.text();
  expect(markAllRes.status(), markAllBody).toBe(200);

  const unreadAfterAllRes = await page.request.get('/api/notifications/unread-count');
  const unreadAfterAllBody = await unreadAfterAllRes.text();
  expect(unreadAfterAllRes.status(), unreadAfterAllBody).toBe(200);
  const unreadAfterAll = Number(JSON.parse(unreadAfterAllBody)?.item?.count ?? 0);
  expect(unreadAfterAll).toBe(0);

  const clearReadRes = await page.request.post('/api/notifications/clear-read');
  const clearReadBody = await clearReadRes.text();
  expect(clearReadRes.status(), clearReadBody).toBe(200);

  const listAfterClearRes = await page.request.get('/api/notifications?limit=20');
  const listAfterClearBody = await listAfterClearRes.text();
  expect(listAfterClearRes.status(), listAfterClearBody).toBe(200);
  const listAfterClear = JSON.parse(listAfterClearBody)?.items ?? [];
  expect(listAfterClear.every((item: { is_read?: boolean }) => !item.is_read)).toBeTruthy();
});

test('calendar invite and upcoming reminder notifications are created for near-term events', async ({ page }) => {
  await loginViaUI(page);
  await setRole(page, 'admin');

  const stamp = Date.now();
  const startsAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const endsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  const eventResponse = await page.request.post('/api/calendar/events', {
    data: {
      title: `E2E Notify Event ${stamp}`,
      startsAt,
      endsAt,
      visibility: 'attendees',
      eventType: 'meeting',
      attendees: [],
    },
  });
  const eventBody = await eventResponse.text();
  if (eventResponse.status() === 400 && eventBody.includes('calendar_events')) {
    test.skip(true, 'calendar tables are not present in this environment');
  }
  expect(eventResponse.status(), eventBody).toBe(200);
  const eventId = JSON.parse(eventBody)?.item?.id;
  expect(eventId).toBeTruthy();

  const listResponse = await page.request.get('/api/notifications?limit=100');
  const listBody = await listResponse.text();
  expect(listResponse.status(), listBody).toBe(200);
  const notifications = JSON.parse(listBody)?.items ?? [];

  const inviteNotification = notifications.find(
    (item: { notification_type?: string; payload?: { eventId?: string } }) =>
      item.notification_type === 'calendar_invite' && String(item.payload?.eventId) === String(eventId)
  );
  expect(Boolean(inviteNotification)).toBe(true);

  const reminderNotification = notifications.find(
    (item: { notification_type?: string; payload?: { eventId?: string } }) =>
      item.notification_type === 'calendar_event_reminder' && String(item.payload?.eventId) === String(eventId)
  );
  expect(Boolean(reminderNotification)).toBe(true);
});
