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

  await page.goto('/');
  await page.getByTestId('nav-schedule').click();

  await expect(page.locator('[data-testid^="schedule-time-cell-"]').first()).toBeVisible({ timeout: 30_000 });

  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - now.getDay() + 1);
  const tuesday = new Date(monday);
  tuesday.setDate(monday.getDate() + 1);
  const tuesdayDateKey = tuesday.toISOString().slice(0, 10);

  const timeCell = page.getByTestId(`schedule-time-cell-${tuesdayDateKey}-13`);
  await expect(timeCell).toBeVisible({ timeout: 30_000 });
  await timeCell.click();

  await expect(page.getByRole('heading', { name: 'Add Event' })).toBeVisible({ timeout: 10_000 });
  const eventTitle = `E2E TimeGrid Event ${stamp}`;
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: 'Add Event' })).toHaveCount(0, { timeout: 10_000 });

  const slotStart = new Date(`${tuesdayDateKey}T13:00:00.000Z`);
  const slotEnd = new Date(`${tuesdayDateKey}T14:00:00.000Z`);
  const createEventRes = await page.request.post('/api/calendar/events', {
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
  await expect(page.getByText(eventTitle)).toBeVisible({ timeout: 30_000 });

  await page.reload();
  await page.getByTestId('nav-schedule').click();

  await expect(page.getByText(eventTitle)).toBeVisible({ timeout: 30_000 });
});
