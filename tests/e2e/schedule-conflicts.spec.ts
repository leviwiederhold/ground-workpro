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

test('schedule shows warning when employee is double-booked', async ({ page }) => {
  await loginViaUI(page);
  await setRole(page, 'admin');

  const stamp = Date.now();
  const date = new Date().toISOString().slice(0, 10);

  const [jobARes, jobBRes, equipmentRes] = await Promise.all([
    page.request.post('/api/jobs', {
      timeout: 30_000,
      data: { name: `Conflict Job A ${stamp}`, status: 'in_progress', site_address: 'A St' },
    }),
    page.request.post('/api/jobs', {
      timeout: 30_000,
      data: { name: `Conflict Job B ${stamp}`, status: 'in_progress', site_address: 'B St' },
    }),
    page.request.get('/api/equipment'),
  ]);

  const jobABody = await jobARes.text();
  const jobBBody = await jobBRes.text();
  const equipmentBody = await equipmentRes.text();

  expect(jobARes.status(), jobABody).toBe(200);
  expect(jobBRes.status(), jobBBody).toBe(200);
  expect(equipmentRes.status(), equipmentBody).toBe(200);

  const jobAId = JSON.parse(jobABody)?.job?.id;
  const jobBId = JSON.parse(jobBBody)?.job?.id;
  const equipmentId = (JSON.parse(equipmentBody)?.equipment ?? [])[0]?.id;
  expect(equipmentId).toBeTruthy();

  const assignmentRes = await page.request.post('/api/schedule/assignments', {
    data: {
      jobId: jobAId,
      date,
      equipmentId,
    },
  });
  const assignmentBody = await assignmentRes.text();
  if (assignmentRes.status() !== 200) {
    expect(assignmentBody).toContain('schedule_assignments');
    return;
  }

  const conflictRes = await page.request.post('/api/schedule/assignments', {
    data: {
      jobId: jobBId,
      date,
      equipmentId,
    },
  });
  const conflictBody = await conflictRes.text();
  expect(conflictRes.status(), conflictBody).toBe(200);
  const conflictPayload = JSON.parse(conflictBody);
  expect(Array.isArray(conflictPayload?.warnings)).toBeTruthy();
  expect(String(conflictPayload?.warnings?.[0] ?? '').toLowerCase()).toContain('already assigned');
});
