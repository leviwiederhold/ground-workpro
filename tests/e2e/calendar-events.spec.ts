import { expect, test, type Page } from '@playwright/test';
import { getE2ECreds, loginViaUI } from './helpers';

type Role = 'admin' | 'pm' | 'foreman' | 'mechanic' | 'operator';

async function setRole(page: Page, role: Role) {
  const response = await page.request.post('/api/test/set-role', { data: { role }, timeout: 30_000 });
  const body = await response.text();
  expect(response.status(), body).toBe(200);
}

function getWeekStartKey(date = new Date()) {
  const normalized = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = normalized.getDay();
  const offsetToMonday = day === 0 ? -6 : 1 - day;
  normalized.setDate(normalized.getDate() + offsetToMonday);
  const year = normalized.getFullYear();
  const month = String(normalized.getMonth() + 1).padStart(2, '0');
  const dayOfMonth = String(normalized.getDate()).padStart(2, '0');
  return `${year}-${month}-${dayOfMonth}`;
}

function atHour(dateKey: string, hour: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
}

test('calendar events persist and attendee visibility is enforced', async ({ page }) => {
  const { email } = getE2ECreds();
  await loginViaUI(page);
  await setRole(page, 'admin');

  const stamp = Date.now();
  const weekStart = getWeekStartKey();

  const operatorEmployeeResponse = await page.request.post('/api/employees', {
    data: {
      name: `E2E Calendar Operator ${stamp}`,
      role: 'Operator',
      email,
    },
    timeout: 30_000,
  });
  const operatorEmployeeBody = await operatorEmployeeResponse.text();
  expect(operatorEmployeeResponse.status(), operatorEmployeeBody).toBe(200);
  const operatorEmployeeId = JSON.parse(operatorEmployeeBody)?.employee?.id;
  expect(operatorEmployeeId).toBeTruthy();

  const visibleEventResponse = await page.request.post('/api/calendar/events', {
    data: {
      title: `E2E Visible Event ${stamp}`,
      startsAt: atHour(weekStart, 14),
      endsAt: atHour(weekStart, 15),
      visibility: 'attendees',
      eventType: 'meeting',
      attendees: [{ type: 'employee', employeeId: operatorEmployeeId }],
    },
    timeout: 30_000,
  });
  const visibleEventBody = await visibleEventResponse.text();
  if (visibleEventResponse.status() === 400 && visibleEventBody.includes('calendar_events')) {
    test.skip(true, 'calendar tables are not present in this environment');
  }
  expect(visibleEventResponse.status(), visibleEventBody).toBe(200);
  const visibleEvent = JSON.parse(visibleEventBody)?.item;
  expect(visibleEvent?.id).toBeTruthy();

  const otherOperatorEmployeeResponse = await page.request.post('/api/employees', {
    data: {
      name: `E2E Calendar Other Operator ${stamp}`,
      role: 'Operator',
      email: `other-operator-${stamp}@example.com`,
    },
    timeout: 30_000,
  });
  const otherOperatorEmployeeBody = await otherOperatorEmployeeResponse.text();
  expect(otherOperatorEmployeeResponse.status(), otherOperatorEmployeeBody).toBe(200);
  const otherOperatorEmployeeId = JSON.parse(otherOperatorEmployeeBody)?.employee?.id;
  expect(otherOperatorEmployeeId).toBeTruthy();

  const hiddenEventResponse = await page.request.post('/api/calendar/events', {
    data: {
      title: `E2E Hidden Event ${stamp}`,
      startsAt: atHour(weekStart, 16),
      endsAt: atHour(weekStart, 17),
      visibility: 'attendees',
      eventType: 'internal',
      attendees: [{ type: 'employee', employeeId: otherOperatorEmployeeId }],
    },
    timeout: 30_000,
  });
  const hiddenEventBody = await hiddenEventResponse.text();
  if (hiddenEventResponse.status() === 400 && hiddenEventBody.includes('calendar_events')) {
    test.skip(true, 'calendar tables are not present in this environment');
  }
  expect(hiddenEventResponse.status(), hiddenEventBody).toBe(200);
  const hiddenEvent = JSON.parse(hiddenEventBody)?.item;
  expect(hiddenEvent?.id).toBeTruthy();

  await setRole(page, 'operator');

  const operatorWeekResponse = await page.request.get(`/api/calendar/week?start=${weekStart}`);
  const operatorWeekBody = await operatorWeekResponse.text();
  expect(operatorWeekResponse.status(), operatorWeekBody).toBe(200);
  const operatorWeek = JSON.parse(operatorWeekBody);
  const titles = (operatorWeek.items || []).map((item: { title: string }) => item.title);

  expect(titles).toContain(`E2E Visible Event ${stamp}`);
  expect(titles).not.toContain(`E2E Hidden Event ${stamp}`);

  // UI rendering can vary by schedule view mode; API visibility checks above are the stable contract.
});
