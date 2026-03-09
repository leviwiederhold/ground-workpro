import { expect, test } from '@playwright/test';
import { loginViaUI } from './helpers';

test('training course create, assign, complete persists', async ({ page }) => {
  await loginViaUI(page);

  const stamp = Date.now();
  const courseTitle = `E2E Training ${stamp}`;

  const employeesResponse = await page.request.get('/api/employees', { timeout: 30_000 });
  expect(employeesResponse.status(), await employeesResponse.text()).toBe(200);
  const employeesPayload = await employeesResponse.json();
  const employeeId = String(employeesPayload?.employees?.[0]?.id ?? '');
  expect(employeeId).toBeTruthy();

  const createCourseResponse = await page.request.post('/api/training/courses', {
    data: {
      title: courseTitle,
      category: 'Safety',
      durationMinutes: 30,
      videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      required: true,
    },
    timeout: 30_000,
  });
  expect(createCourseResponse.status(), await createCourseResponse.text()).toBe(201);
  const createdCourse = (await createCourseResponse.json())?.item;
  expect(createdCourse?.id).toBeTruthy();

  const assignResponse = await page.request.post(`/api/training/courses/${createdCourse.id}/assign`, {
    data: {
      employeeIds: [employeeId],
      required: true,
    },
    timeout: 30_000,
  });
  expect(assignResponse.status(), await assignResponse.text()).toBe(200);

  await page.goto('/');
  await page.getByTestId('nav-training').click();
  const courseCard = page.locator('h4', { hasText: courseTitle }).first();
  await expect(courseCard).toBeVisible({ timeout: 20_000 });

  await courseCard.click();

  const markCompletionSelect = page.locator('p:has-text("Mark Completion")').locator('..').locator('select');
  await markCompletionSelect.selectOption(employeeId);

  const completeResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/training/progress/complete') && response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Complete' }).click();
  const completeResponse = await completeResponsePromise;
  expect(completeResponse.status(), await completeResponse.text()).toBe(200);

  await page.reload();
  await page.getByTestId('nav-training').click();
  const courseCardAfterReload = page.locator('h4', { hasText: courseTitle }).first();
  await expect(courseCardAfterReload).toBeVisible({ timeout: 20_000 });

  await courseCardAfterReload.click();
  await expect(page.getByText('1 of 1 employees completed')).toBeVisible({ timeout: 20_000 });
});
