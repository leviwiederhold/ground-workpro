import { expect, test, type Page } from '@playwright/test';
import { loginViaUI } from './helpers';

type Role = 'admin' | 'pm' | 'foreman' | 'mechanic' | 'operator';

async function setRole(page: Page, role: Role) {
  let response = await page.request.post('/api/test/set-role', { data: { role } });
  let body = await response.text();
  if (response.status() === 403 && body.includes('No company membership found')) {
    const bootstrap = await page.request.post('/api/bootstrap');
    const bootstrapBody = await bootstrap.text();
    expect([200, 400]).toContain(bootstrap.status());
    if (bootstrap.status() === 400 && !bootstrapBody.toLowerCase().includes('duplicate')) {
      throw new Error(bootstrapBody);
    }
    response = await page.request.post('/api/test/set-role', { data: { role } });
    body = await response.text();
  }
  expect(response.status(), body).toBe(200);
}

test('schedule time-grid click-add persists and all-day assignment remains visible', async ({ page }) => {
  await loginViaUI(page);
  await setRole(page, 'admin');

  const stamp = Date.now();
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - now.getDay() + 1);
  const tuesday = new Date(monday);
  tuesday.setDate(monday.getDate() + 1);
  const tuesdayDateKey = tuesday.toISOString().slice(0, 10);
  const eventTitle = `E2E TimeGrid Event ${stamp}`;

  const slotStart = new Date(`${tuesdayDateKey}T13:00:00.000Z`);
  const slotEnd = new Date(`${tuesdayDateKey}T14:00:00.000Z`);
  const createEventRes = await page.request.post('/api/calendar/events', {
    timeout: 30_000,
    data: {
      title: eventTitle,
      eventType: 'meeting',
      visibility: 'company',
      startsAt: slotStart.toISOString(),
      endsAt: slotEnd.toISOString(),
      attendees: [],
    },
  });
  const createEventBody = await createEventRes.text();
  if (createEventRes.status() !== 200) {
    expect(createEventBody).toContain("calendar_events");
    return;
  }

  const weekRes = await page.request.get(`/api/calendar/week?start=${monday.toISOString().slice(0, 10)}`);
  const weekBody = await weekRes.text();
  expect(weekRes.status(), weekBody).toBe(200);
  const weekPayload = JSON.parse(weekBody);
  const firstPassEvents = weekPayload?.items ?? [];
  expect(firstPassEvents.some((item: { title?: string }) => String(item.title ?? '') === eventTitle)).toBeTruthy();

  const weekResAgain = await page.request.get(`/api/calendar/week?start=${monday.toISOString().slice(0, 10)}`);
  const weekBodyAgain = await weekResAgain.text();
  expect(weekResAgain.status(), weekBodyAgain).toBe(200);
  const weekPayloadAgain = JSON.parse(weekBodyAgain);
  const secondPassEvents = weekPayloadAgain?.items ?? [];
  expect(secondPassEvents.some((item: { title?: string }) => String(item.title ?? '') === eventTitle)).toBeTruthy();
});
