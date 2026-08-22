import { expect, test, type Browser, type Page } from '@playwright/test';
import { loginViaUI } from './helpers';

async function setOwnerRole(page: Page) {
  const response = await page.request.post('/api/test/set-role', { data: { role: 'admin' } });
  expect(response.status(), await response.text()).toBe(200);
}

async function createEmployeeFromCode(
  browser: Browser,
  code: string,
  email: string,
  password: string,
  baseURL: string
) {
  const context = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  await page.goto(`/signup?join=1&code=${encodeURIComponent(code)}`);
  await page.locator('input[autocomplete="given-name"]').fill('Join');
  await page.locator('input[autocomplete="family-name"]').fill('Employee');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/\/web-access-restricted/, { timeout: 30_000 });
  return { context, page };
}

async function loginFreshUser(
  browser: Browser,
  email: string,
  password: string,
  baseURL: string
) {
  const context = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  const response = await page.request.post('/api/test/login', { data: { email, password } });
  expect(response.status(), await response.text()).toBe(200);
  return { context, page };
}

async function generateJoinCode(page: Page) {
  const response = await page.request.post('/api/team/join-code');
  const body = await response.text();
  expect(response.status(), body).toBe(200);
  const code = String(JSON.parse(body)?.item?.code ?? '');
  expect(code).toMatch(/^[A-Z2-9]{6}$/);
  return code;
}

test('shared employee code regenerates securely, assigns Employee, and blocks the web dashboard', async ({ page, browser }) => {
  await loginViaUI(page);
  await setOwnerRole(page);

  const firstGenerate = await page.request.post('/api/team/join-code');
  const firstBody = await firstGenerate.text();
  expect(firstGenerate.status(), firstBody).toBe(200);
  const firstCode = String(JSON.parse(firstBody)?.item?.code ?? '');
  expect(firstCode).toMatch(/^[A-Z2-9]{6}$/);

  const secondGenerate = await page.request.post('/api/team/join-code');
  const secondBody = await secondGenerate.text();
  expect(secondGenerate.status(), secondBody).toBe(200);
  const secondItem = JSON.parse(secondBody)?.item;
  const secondCode = String(secondItem?.code ?? '');
  expect(secondCode).toMatch(/^[A-Z2-9]{6}$/);
  expect(secondCode).not.toBe(firstCode);
  expect(Date.parse(String(secondItem?.expires_at)) - Date.parse(String(secondItem?.created_at))).toBe(24 * 60 * 60 * 1000);

  const replacedValidation = await page.request.post('/api/join/validate', { data: { code: firstCode } });
  expect(replacedValidation.status()).toBe(404);
  const currentValidation = await page.request.post('/api/join/validate', { data: { code: secondCode } });
  expect(currentValidation.status(), await currentValidation.text()).toBe(200);

  const stamp = Date.now();
  const email = `join-code-${stamp}@example.com`;
  const password = `JoinCode!${stamp}`;
  const { context, page: employeePage } = await createEmployeeFromCode(
    browser,
    secondCode,
    email,
    password,
    new URL(page.url()).origin
  );

  await expect(employeePage.getByRole('heading', { name: 'Use the Groundwork Pro mobile app' })).toBeVisible();
  const protectedLoaderRequests: string[] = [];
  const captureProtectedLoader = (request: { url(): string }) => {
    const pathname = new URL(request.url()).pathname;
    if (['/api/dashboard', '/api/dashboard/summary', '/api/bootstrap', '/api/stats'].includes(pathname)) {
      protectedLoaderRequests.push(pathname);
    }
  };
  employeePage.on('request', captureProtectedLoader);
  const directDashboard = await employeePage.goto('/');
  expect(directDashboard?.url()).toContain('/web-access-restricted');
  expect(protectedLoaderRequests).toEqual([]);
  employeePage.off('request', captureProtectedLoader);

  const escalation = await employeePage.request.post('/api/join/accept', {
    data: { code: secondCode, role: 'admin' },
  });
  expect(escalation.status()).toBe(422);

  let employeeId = '';
  await expect.poll(async () => {
    const team = await page.request.get('/api/team?limit=100');
    if (!team.ok()) return 'missing';
    const payload = await team.json();
    const employee = (payload?.items ?? []).find(
      (item: { email?: string }) => String(item.email ?? '').toLowerCase() === email
    );
    employeeId = String(employee?.id ?? '');
    return `${String(employee?.accountStatus ?? '')}::${String(employee?.role ?? '')}::${String(employee?.roleReviewPending ?? '')}`;
  }, { timeout: 30_000 }).toBe('active::operator::true');

  const ageReview = await page.request.post('/api/test/employee-join-code', {
    data: { operation: 'age_review', employee_id: employeeId, days: 45 },
  });
  expect(ageReview.status(), await ageReview.text()).toBe(200);
  await expect.poll(async () => {
    const team = await page.request.get('/api/team?limit=100');
    if (!team.ok()) return false;
    const payload = await team.json();
    return Boolean((payload?.items ?? []).find(
      (item: { id?: string }) => String(item.id ?? '') === employeeId
    )?.roleReviewPending);
  }).toBe(true);

  // Role review is advisory only. Entering through the native route marks the
  // session as mobile and must allow the still-pending Employee into the app.
  await employeePage.goto('/native');
  await employeePage.goto('/');
  expect(employeePage.url()).not.toContain('/web-access-restricted');

  const selfPromotion = await employeePage.request.patch(`/api/employees/${employeeId}`, {
    data: { role: 'admin' },
  });
  expect(selfPromotion.status(), await selfPromotion.text()).toBe(403);

  await page.goto('/team', { timeout: 30_000 });
  await expect(page.getByTestId('employee-role-review-card')).toBeVisible();
  await page.getByTestId('employee-role-review-open').click();
  await page.getByTestId(`employee-role-review-select-${employeeId}`).selectOption('foreman');
  await page.getByTestId(`employee-role-review-save-${employeeId}`).click();
  await expect.poll(async () => {
    const team = await page.request.get('/api/team?limit=100');
    if (!team.ok()) return 'missing';
    const payload = await team.json();
    const employee = (payload?.items ?? []).find(
      (item: { email?: string }) => String(item.email ?? '').toLowerCase() === email
    );
    return `${String(employee?.role ?? '')}::${String(employee?.roleReviewPending ?? '')}`;
  }, { timeout: 30_000 }).toBe('foreman::false');

  const secondEmail = `join-code-second-${stamp}@example.com`;
  const secondEmployee = await createEmployeeFromCode(
    browser,
    secondCode,
    secondEmail,
    password,
    new URL(page.url()).origin
  );
  await expect(secondEmployee.page.getByRole('heading', { name: 'Use the Groundwork Pro mobile app' })).toBeVisible();
  await expect.poll(async () => {
    const team = await page.request.get('/api/team?limit=100');
    if (!team.ok()) return 'missing';
    const payload = await team.json();
    const employee = (payload?.items ?? []).find(
      (item: { email?: string }) => String(item.email ?? '').toLowerCase() === secondEmail
    );
    return `${String(employee?.accountStatus ?? '')}::${String(employee?.role ?? '')}::${String(employee?.roleReviewPending ?? '')}`;
  }, { timeout: 30_000 }).toBe('active::operator::true');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('employee-role-review-card')).toBeVisible();
  await page.getByTestId('employee-role-review-open').click();
  const secondTeamResponse = await page.request.get('/api/team?limit=100');
  const secondTeamBody = await secondTeamResponse.text();
  expect(secondTeamResponse.status(), secondTeamBody).toBe(200);
  const secondTeam = JSON.parse(secondTeamBody);
  const secondEmployeeId = String((secondTeam?.items ?? []).find(
    (item: { email?: string }) => String(item.email ?? '').toLowerCase() === secondEmail
  )?.id ?? '');
  expect(secondEmployeeId).toBeTruthy();
  await page.getByTestId(`employee-role-review-save-${secondEmployeeId}`).click();
  await expect.poll(async () => {
    const team = await page.request.get('/api/team?limit=100');
    if (!team.ok()) return 'missing';
    const payload = await team.json();
    const employee = (payload?.items ?? []).find(
      (item: { email?: string }) => String(item.email ?? '').toLowerCase() === secondEmail
    );
    return `${String(employee?.role ?? '')}::${String(employee?.roleReviewPending ?? '')}`;
  }, { timeout: 30_000 }).toBe('operator::false');

  await context.close();
  await secondEmployee.context.close();
});

test('database join guards rate-limit guessing, serialize duplicates, reject second companies, and enforce expiry', async ({ page, browser }) => {
  await loginViaUI(page);
  await setOwnerRole(page);
  const activeSubscription = await page.request.post('/api/test/set-subscription', {
    data: { subscription_status: 'active' },
  });
  expect(activeSubscription.status(), await activeSubscription.text()).toBe(200);

  await page.goto('/');
  expect(page.url()).not.toContain('/web-access-restricted');
  const code = await generateJoinCode(page);
  const baseURL = new URL(page.url()).origin;
  const stamp = Date.now();
  const employeeEmail = `join-race-${stamp}@example.com`;
  const employeePassword = `JoinRace!${stamp}`;
  const employee = await loginFreshUser(browser, employeeEmail, employeePassword, baseURL);
  const joinHeaders = { 'x-forwarded-for': `198.51.100.${(stamp % 200) + 1}` };

  const concurrent = await Promise.all([
    employee.page.request.post('/api/join/accept', {
      data: { code, full_name: 'Concurrent Employee' },
      headers: joinHeaders,
    }),
    employee.page.request.post('/api/join/accept', {
      data: { code, full_name: 'Concurrent Employee' },
      headers: joinHeaders,
    }),
  ]);
  expect(concurrent.map((response) => response.status()).sort((left, right) => left - right)).toEqual([200, 409]);

  const duplicate = await employee.page.request.post('/api/join/accept', {
    data: { code, full_name: 'Concurrent Employee' },
    headers: joinHeaders,
  });
  expect(duplicate.status(), await duplicate.text()).toBe(409);

  const firstAudit = await page.request.post('/api/test/employee-join-code', {
    data: { operation: 'audit_member', email: employeeEmail },
  });
  const firstAuditBody = await firstAudit.text();
  expect(firstAudit.status(), firstAuditBody).toBe(200);
  expect(JSON.parse(firstAuditBody)?.item).toMatchObject({ membership_count: 1, employee_count: 1 });

  // A fresh owner bootstrap proves new-company onboarding still works and gives
  // us a second active company for the cross-company membership guard.
  const secondOwnerEmail = `join-owner-${stamp}@example.com`;
  const secondOwnerPassword = `JoinOwner!${stamp}`;
  const secondOwner = await loginFreshUser(browser, secondOwnerEmail, secondOwnerPassword, baseURL);
  const bootstrap = await secondOwner.page.request.post('/api/bootstrap');
  expect(bootstrap.status(), await bootstrap.text()).toBe(200);
  await setOwnerRole(secondOwner.page);
  const secondActiveSubscription = await secondOwner.page.request.post('/api/test/set-subscription', {
    data: { subscription_status: 'active' },
  });
  expect(secondActiveSubscription.status(), await secondActiveSubscription.text()).toBe(200);
  const setupResponse = await secondOwner.page.goto('/setup');
  expect(setupResponse?.status()).toBe(200);
  expect(secondOwner.page.url()).not.toContain('/web-access-restricted');
  const secondCompanyCode = await generateJoinCode(secondOwner.page);

  const secondCompanyAttempt = await employee.page.request.post('/api/join/accept', {
    data: { code: secondCompanyCode, full_name: 'Concurrent Employee' },
    headers: joinHeaders,
  });
  expect(secondCompanyAttempt.status(), await secondCompanyAttempt.text()).toBe(409);

  const finalAudit = await page.request.post('/api/test/employee-join-code', {
    data: { operation: 'audit_member', email: employeeEmail },
  });
  const finalAuditBody = await finalAudit.text();
  expect(finalAudit.status(), finalAuditBody).toBe(200);
  expect(JSON.parse(finalAuditBody)?.item).toMatchObject({ membership_count: 1, employee_count: 1 });

  const expire = await page.request.post('/api/test/employee-join-code', {
    data: { operation: 'expire_current' },
  });
  expect(expire.status(), await expire.text()).toBe(200);
  const expiredValidation = await page.request.post('/api/join/validate', {
    data: { code },
    headers: { 'x-forwarded-for': `203.0.113.${(stamp % 200) + 1}` },
  });
  expect(expiredValidation.status(), await expiredValidation.text()).toBe(410);

  const expiredUser = await loginFreshUser(
    browser,
    `join-expired-${stamp}@example.com`,
    `JoinExpired!${stamp}`,
    baseURL
  );
  const expiredAccept = await expiredUser.page.request.post('/api/join/accept', {
    data: { code, full_name: 'Expired Employee' },
    headers: { 'x-forwarded-for': `192.0.2.${(stamp % 200) + 1}` },
  });
  expect(expiredAccept.status(), await expiredAccept.text()).toBe(410);

  // The process-local guard allows 60/minute; a 429 on attempt 21 therefore
  // confirms the shared database limiter is the enforcement source.
  const guessHeaders = { 'x-forwarded-for': `192.0.2.${((stamp + 37) % 200) + 1}` };
  const guessStatuses: number[] = [];
  for (let attempt = 0; attempt < 21; attempt += 1) {
    const guess = await page.request.post('/api/join/validate', {
      data: { code: 'AAAAA2' },
      headers: guessHeaders,
    });
    guessStatuses.push(guess.status());
    if (attempt === 20) {
      expect(guess.headers()['retry-after']).toBeTruthy();
    }
  }
  expect(guessStatuses.slice(0, 20).every((status) => status === 404)).toBe(true);
  expect(guessStatuses[20]).toBe(429);

  await employee.context.close();
  await secondOwner.context.close();
  await expiredUser.context.close();
});
