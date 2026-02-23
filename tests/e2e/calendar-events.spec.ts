import { expect, test, type Page } from '@playwright/test';
import { getE2ECreds, loginViaUI } from './helpers';

type Role = 'admin' | 'pm' | 'foreman' | 'mechanic' | 'operator';

async function setRole(page: Page, role: Role) {
  const response = await page.request.post('/api/test/set-role', { data: { role } });
  const body = await response.text();
  expect(response.status(), body).toBe(200);
}

function getWeekStartKey(date = new Date()) {
  const normalized = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = normalized.getUTCDay();
  const offsetToMonday = day === 0 ? -6 : 1 - day;
  normalized.setUTCDate(normalized.getUTCDate() + offsetToMonday);
  return normalized.toISOString().slice(0, 10);
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
  });
  const visibleEventBody = await visibleEventResponse.text();
  expect(visibleEventResponse.status(), visibleEventBody).toBe(200);
  const visibleEvent = JSON.parse(visibleEventBody)?.item;
  expect(visibleEvent?.id).toBeTruthy();

  const otherOperatorEmployeeResponse = await page.request.post('/api/employees', {
    data: {
      name: `E2E Calendar Other Operator ${stamp}`,
      role: 'Operator',
      email: `other-operator-${stamp}@example.com`,
    },
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
  });
  const hiddenEventBody = await hiddenEventResponse.text();
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

  await page.goto('/');
  await page.getByTestId('nav-schedule').click();
  await expect(page.getByText(`E2E Visible Event ${stamp}`)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`E2E Hidden Event ${stamp}`)).toHaveCount(0);
});
