import { expect, test, type Page } from '@playwright/test';
import { loginViaUI } from './helpers';

type Role = 'admin' | 'pm' | 'foreman' | 'mechanic' | 'operator';

async function setRole(page: Page, role: Role) {
  const response = await page.request.post('/api/test/set-role', { data: { role } });
  const body = await response.text();
  expect(response.status(), body).toBe(200);
}

test('operator is blocked from company week and only sees personal week data', async ({ page }) => {
  await loginViaUI(page);
  await setRole(page, 'admin');

  const stamp = Date.now();
  const date = new Date().toISOString().slice(0, 10);

  const [jobARes, jobBRes] = await Promise.all([
    page.request.post('/api/jobs', {
      data: { name: `My Week Job A ${stamp}`, status: 'in_progress', site_address: 'A St' },
    }),
    page.request.post('/api/jobs', {
      data: { name: `My Week Job B ${stamp}`, status: 'in_progress', site_address: 'B St' },
    }),
  ]);

  const jobABody = await jobARes.text();
  const jobBBody = await jobBRes.text();
  expect(jobARes.status(), jobABody).toBe(200);
  expect(jobBRes.status(), jobBBody).toBe(200);
  const jobAId = JSON.parse(jobABody)?.job?.id;
  const jobBId = JSON.parse(jobBBody)?.job?.id;

  const [operatorRes, foremanRes] = await Promise.all([
    page.request.post('/api/employees', {
      data: { name: `Week Operator ${stamp}`, role: 'Operator' },
    }),
    page.request.post('/api/employees', {
      data: { name: `Week Foreman ${stamp}`, role: 'Foreman' },
    }),
  ]);
  const operatorBody = await operatorRes.text();
  const foremanBody = await foremanRes.text();
  expect(operatorRes.status(), operatorBody).toBe(200);
  expect(foremanRes.status(), foremanBody).toBe(200);

  const operatorEmployeeId = JSON.parse(operatorBody)?.employee?.id;
  const foremanEmployeeId = JSON.parse(foremanBody)?.employee?.id;

  const [operatorAssignRes, foremanAssignRes] = await Promise.all([
    page.request.post('/api/schedule/assignments', {
      data: { jobId: jobAId, date, employeeId: operatorEmployeeId },
    }),
    page.request.post('/api/schedule/assignments', {
      data: { jobId: jobBId, date, employeeId: foremanEmployeeId },
    }),
  ]);
  expect(operatorAssignRes.status(), await operatorAssignRes.text()).toBe(200);
  expect(foremanAssignRes.status(), await foremanAssignRes.text()).toBe(200);

  const [visibleEventRes, hiddenEventRes] = await Promise.all([
    page.request.post('/api/calendar/events', {
      data: {
        title: `My Week Visible ${stamp}`,
        startsAt: `${date}T14:00:00.000Z`,
        endsAt: `${date}T15:00:00.000Z`,
        visibility: 'attendees',
        eventType: 'meeting',
        attendees: [{ attendeeType: 'employee', employeeId: operatorEmployeeId }],
      },
    }),
    page.request.post('/api/calendar/events', {
      data: {
        title: `My Week Hidden ${stamp}`,
        startsAt: `${date}T16:00:00.000Z`,
        endsAt: `${date}T17:00:00.000Z`,
        visibility: 'attendees',
        eventType: 'internal',
        attendees: [{ attendeeType: 'employee', employeeId: foremanEmployeeId }],
      },
    }),
  ]);
  expect(visibleEventRes.status(), await visibleEventRes.text()).toBe(200);
  expect(hiddenEventRes.status(), await hiddenEventRes.text()).toBe(200);

  await setRole(page, 'operator');

  const companyWeekRes = await page.request.get(`/api/schedule/week?start=${date}`);
  const companyWeekBody = await companyWeekRes.text();
  expect(companyWeekRes.status(), companyWeekBody).toBe(403);
  expect(JSON.parse(companyWeekBody)).toEqual({ error: 'Forbidden' });

  const myWeekRes = await page.request.get(`/api/schedule/my-week?start=${date}`);
  const myWeekBody = await myWeekRes.text();
  expect(myWeekRes.status(), myWeekBody).toBe(200);

  const payload = JSON.parse(myWeekBody);
  const assignments = payload?.items?.assignments || [];
  const events = payload?.items?.events || [];

  expect(assignments.some((assignment: { jobId: string; employeeId: string | null }) => String(assignment.jobId) === String(jobAId) && String(assignment.employeeId) === String(operatorEmployeeId))).toBe(true);
  expect(assignments.some((assignment: { jobId: string; employeeId: string | null }) => String(assignment.jobId) === String(jobBId) && String(assignment.employeeId) === String(foremanEmployeeId))).toBe(false);

  expect(events.some((event: { title: string }) => event.title === `My Week Visible ${stamp}`)).toBe(true);
  expect(events.some((event: { title: string }) => event.title === `My Week Hidden ${stamp}`)).toBe(false);
});
