import { expect, test, type Page } from '@playwright/test';
import { loginViaUI } from './helpers';

async function forceAdminRole(page: Page) {
  let response = await page.request.post('/api/test/set-role', { data: { role: 'admin' } });
  let body = await response.text();
  if (response.status() === 403 && body.includes('No company membership found')) {
    await page.request.post('/api/bootstrap');
    response = await page.request.post('/api/test/set-role', { data: { role: 'admin' } });
    body = await response.text();
  }
  expect(response.status(), body).toBe(200);
}

async function setRole(page: Page, role: 'admin' | 'pm' | 'foreman' | 'mechanic' | 'operator') {
  const response = await page.request.post('/api/test/set-role', { data: { role } });
  const body = await response.text();
  expect(response.status(), body).toBe(200);
}

test('messages direct threads persist across reload (api contract)', async ({ page }) => {
  await loginViaUI(page);
  await forceAdminRole(page);

  const usersRes = await page.request.get('/api/messages/users');
  const usersBody = await usersRes.text();
  expect(usersRes.status(), usersBody).toBe(200);
  const users = (JSON.parse(usersBody)?.items ?? []) as Array<{ userId: string }>;
  if (users.length === 0) {
    test.skip(true, 'No teammate account available for direct-message test');
  }

  const targetUserId = String(users[0].userId);
  const messageBody = `e2e message ${Date.now()}`;

  const startRes = await page.request.post('/api/messages/direct/start', {
    data: { userId: targetUserId },
  });
  const startBody = await startRes.text();
  expect(startRes.status(), startBody).toBe(201);
  const threadId = String(JSON.parse(startBody)?.item?.id ?? '');
  expect(threadId).toBeTruthy();

  const sendRes = await page.request.post(`/api/messages/threads/${threadId}/send`, {
    data: { body: messageBody },
  });
  const sendBody = await sendRes.text();
  expect(sendRes.status(), sendBody).toBe(201);

  const readRes = await page.request.get(`/api/messages/threads/${threadId}/messages`);
  expect(readRes.status()).toBe(200);
  const readJson = await readRes.json();
  const rows = Array.isArray(readJson?.items) ? readJson.items : [];
  expect(rows.some((row: { body: string }) => String(row.body) === messageBody)).toBeTruthy();

  await page.reload();

  const readResAfter = await page.request.get(`/api/messages/threads/${threadId}/messages`);
  expect(readResAfter.status()).toBe(200);
  const readJsonAfter = await readResAfter.json();
  const rowsAfter = Array.isArray(readJsonAfter?.items) ? readJsonAfter.items : [];
  expect(rowsAfter.some((row: { body: string }) => String(row.body) === messageBody)).toBeTruthy();
});

test('messages inbox loads without RLS recursion errors', async ({ page }) => {
  await loginViaUI(page);
  await forceAdminRole(page);

  const inboxRes = await page.request.get('/api/messages/inbox');
  const inboxBody = await inboxRes.text();
  expect(inboxRes.status(), inboxBody).toBe(200);
  expect(inboxBody.toLowerCase()).not.toContain('infinite recursion');
  expect(inboxBody.toLowerCase()).not.toContain('message_participants');
});

test('employee can message CEO and first direct message succeeds', async ({ page }) => {
  await loginViaUI(page);
  await forceAdminRole(page);

  const stamp = Date.now();
  const employeeEmail = `msg-operator-${stamp}@example.com`;
  const employeePassword = `MsgPass!${stamp}`;

  const createEmployeeRes = await page.request.post('/api/employees', {
    data: {
      name: `Msg Operator ${stamp}`,
      email: employeeEmail,
      role: 'Operator',
      status: 'active',
    },
  });
  const createEmployeeBody = await createEmployeeRes.text();
  expect(createEmployeeRes.status(), createEmployeeBody).toBe(200);
  const employeeId = String(JSON.parse(createEmployeeBody)?.employee?.id ?? '');
  expect(employeeId).toBeTruthy();

  const inviteRes = await page.request.post('/api/invite/create', {
    data: {
      employeeId,
      email: employeeEmail,
      role: 'operator',
    },
  });
  const inviteBody = await inviteRes.text();
  expect(inviteRes.status(), inviteBody).toBe(200);
  const inviteToken = String(JSON.parse(inviteBody)?.item?.token ?? '');
  expect(inviteToken.length).toBeGreaterThanOrEqual(20);

  const acceptRes = await page.request.post('/api/test/accept-invite', {
    data: {
      token: inviteToken,
      email: employeeEmail,
      password: employeePassword,
    },
  });
  const acceptBody = await acceptRes.text();
  expect(acceptRes.status(), acceptBody).toBe(200);

  const loginEmployeeRes = await page.request.post('/api/test/login', {
    data: {
      email: employeeEmail,
      password: employeePassword,
    },
  });
  const loginEmployeeBody = await loginEmployeeRes.text();
  expect(loginEmployeeRes.status(), loginEmployeeBody).toBe(200);

  await setRole(page, 'operator');

  const usersRes = await page.request.get('/api/messages/users');
  const usersBody = await usersRes.text();
  expect(usersRes.status(), usersBody).toBe(200);
  const users = (JSON.parse(usersBody)?.items ?? []) as Array<{ userId: string; role?: string }>;
  const ceoRecipient = users.find((user) => String(user.role || '').toLowerCase() === 'ceo');
  expect(ceoRecipient?.userId).toBeTruthy();

  const startRes = await page.request.post('/api/messages/direct/start', {
    data: { userId: String(ceoRecipient?.userId) },
  });
  const startBody = await startRes.text();
  expect(startRes.status(), startBody).toBe(201);
  const startJson = JSON.parse(startBody);
  const threadId = String(startJson?.item?.id ?? '');
  expect(threadId).toBeTruthy();
  expect(String(startJson?.item?.kind ?? '')).toBe('direct');

  const messageText = `first-direct-message-${stamp}`;
  const sendRes = await page.request.post(`/api/messages/threads/${threadId}/send`, {
    data: { body: messageText },
  });
  const sendBody = await sendRes.text();
  expect(sendRes.status(), sendBody).toBe(201);
});

test('recipient sees CEO direct thread and message body', async ({ page }) => {
  await loginViaUI(page);
  await forceAdminRole(page);

  const stamp = Date.now();
  const managerEmail = `msg-manager-${stamp}@example.com`;
  const managerPassword = `MsgManager!${stamp}`;

  const createEmployeeRes = await page.request.post('/api/employees', {
    data: {
      name: `Msg Manager ${stamp}`,
      email: managerEmail,
      role: 'PM',
      status: 'active',
    },
  });
  const createEmployeeBody = await createEmployeeRes.text();
  expect(createEmployeeRes.status(), createEmployeeBody).toBe(200);
  const employeeId = String(JSON.parse(createEmployeeBody)?.employee?.id ?? '');
  expect(employeeId).toBeTruthy();

  const inviteRes = await page.request.post('/api/invite/create', {
    data: {
      employeeId,
      email: managerEmail,
      role: 'manager',
    },
  });
  const inviteBody = await inviteRes.text();
  expect(inviteRes.status(), inviteBody).toBe(200);
  const inviteToken = String(JSON.parse(inviteBody)?.item?.token ?? '');
  expect(inviteToken.length).toBeGreaterThanOrEqual(20);

  const acceptRes = await page.request.post('/api/test/accept-invite', {
    data: {
      token: inviteToken,
      email: managerEmail,
      password: managerPassword,
    },
  });
  const acceptBody = await acceptRes.text();
  expect(acceptRes.status(), acceptBody).toBe(200);
  const managerUserId = String(JSON.parse(acceptBody)?.item?.userId ?? '');
  expect(managerUserId).toBeTruthy();

  await forceAdminRole(page);

  const startRes = await page.request.post('/api/messages/direct/start', {
    data: { userId: managerUserId },
  });
  const startBody = await startRes.text();
  expect(startRes.status(), startBody).toBe(201);
  const threadId = String(JSON.parse(startBody)?.item?.id ?? '');
  expect(threadId).toBeTruthy();

  const membersRes = await page.request.get(`/api/messages/channels/${threadId}/members`);
  const membersBody = await membersRes.text();
  expect(membersRes.status(), membersBody).toBe(200);
  const members = (JSON.parse(membersBody)?.items ?? []) as Array<{ userId?: string }>;
  expect(members.some((member) => String(member.userId || '') === managerUserId)).toBeTruthy();
  expect(members.length).toBeGreaterThanOrEqual(2);

  const messageBody = `ceo-to-manager-${stamp}`;
  const sendRes = await page.request.post(`/api/messages/threads/${threadId}/send`, {
    data: { body: messageBody },
  });
  const sendBody = await sendRes.text();
  expect(sendRes.status(), sendBody).toBe(201);

  const loginManagerRes = await page.request.post('/api/test/login', {
    data: {
      email: managerEmail,
      password: managerPassword,
    },
  });
  const loginManagerBody = await loginManagerRes.text();
  expect(loginManagerRes.status(), loginManagerBody).toBe(200);

  await setRole(page, 'pm');

  const inboxRes = await page.request.get('/api/messages/inbox');
  const inboxBody = await inboxRes.text();
  expect(inboxRes.status(), inboxBody).toBe(200);
  const inboxItems = (JSON.parse(inboxBody)?.items ?? []) as Array<{ id?: string }>;
  expect(inboxItems.some((item) => String(item.id || '') === threadId)).toBeTruthy();

  const threadMessagesRes = await page.request.get(`/api/messages/threads/${threadId}/messages`);
  const threadMessagesBody = await threadMessagesRes.text();
  expect(threadMessagesRes.status(), threadMessagesBody).toBe(200);
  const threadMessages = (JSON.parse(threadMessagesBody)?.items ?? []) as Array<{ body?: string }>;
  expect(threadMessages.some((row) => String(row.body || '') === messageBody)).toBeTruthy();
});
