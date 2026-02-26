import { expect, test } from '@playwright/test';
import { loginViaUI } from './helpers';

test('safety operations workflow persists', async ({ page }) => {
  await loginViaUI(page);

  const stamp = Date.now();
  const topic = `E2E Safety Topic ${stamp}`;

  await page.goto('/');
  await page.getByTestId('nav-safety').click();
  await expect(page.getByTestId('safety-open-create')).toBeVisible();

  await page.getByTestId('safety-open-create').click();
  await page.getByTestId('safety-topic').selectOption({ index: 1 });
  await page.getByTestId('safety-notes').fill(topic);

  const createLogResponsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/safety-logs') && response.request().method() === 'POST'
  );
  await page.getByTestId('safety-submit').click();
  const createLogResponse = await createLogResponsePromise;
  const createLogBody = await createLogResponse.text();
  expect(createLogResponse.status(), createLogBody).toBe(201);
  const createdLogPayload = JSON.parse(createLogBody);
  const logId = String(createdLogPayload?.item?.id ?? '');
  expect(logId).toBeTruthy();

  const employeesResponse = await page.request.get('/api/employees');
  expect(employeesResponse.status(), await employeesResponse.text()).toBe(200);
  const employeesPayload = await employeesResponse.json();
  const employeeId = String(employeesPayload?.employees?.[0]?.id ?? '');

  const createActionResponse = await page.request.post('/api/safety-actions', {
    data: {
      safety_log_id: logId,
      title: `Corrective Action ${stamp}`,
      owner_employee_id: employeeId || null,
      priority: 'high',
    },
  });
  expect(createActionResponse.status(), await createActionResponse.text()).toBe(201);
  const actionPayload = await createActionResponse.json();
  const actionId = String(actionPayload?.item?.id ?? '');
  expect(actionId).toBeTruthy();

  const closeActionResponse = await page.request.patch(`/api/safety-actions/${actionId}`, {
    data: { status: 'closed' },
  });
  expect(closeActionResponse.status(), await closeActionResponse.text()).toBe(200);

  const createTalkResponse = await page.request.post('/api/toolbox-talks', {
    data: {
      topic: `Toolbox ${stamp}`,
      summary: 'Ops workflow test',
      occurred_on: new Date().toISOString().slice(0, 10),
      attendee_employee_ids: employeeId ? [employeeId] : [],
    },
  });
  expect(createTalkResponse.status(), await createTalkResponse.text()).toBe(201);

  await page.reload();
  await page.getByTestId('nav-safety').click();

  await expect(page.getByText(`Toolbox ${stamp}`)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Open Hazards')).toBeVisible();
});
