import { expect, test, type Page } from '@playwright/test';

type Role = 'admin' | 'pm' | 'foreman' | 'mechanic' | 'operator';
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';

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

  await page.context().addCookies([
    {
      name: 'e2e_role',
      value: role,
      url: BASE_URL,
    },
  ]);
}

test('messages direct threads are company scoped and sendable across roles', async ({ page }) => {
  await setRole(page, 'admin');

  const usersRes = await page.request.get('/api/messages/users');
  const usersBody = await usersRes.text();
  expect(usersRes.status(), usersBody).toBe(200);
  const users = (JSON.parse(usersBody)?.items ?? []) as Array<{ userId: string }>;
  if (users.length === 0) {
    test.skip(true, 'No teammate account available for role messaging test');
  }

  const targetUserId = String(users[0].userId);

  const startRes = await page.request.post('/api/messages/direct/start', {
    data: { userId: targetUserId },
  });
  const startBody = await startRes.text();
  expect(startRes.status(), startBody).toBe(201);
  const threadId = String(JSON.parse(startBody)?.item?.id ?? '');
  expect(threadId).toBeTruthy();

  await setRole(page, 'foreman');
  const foremanSendRes = await page.request.post(`/api/messages/threads/${threadId}/send`, {
    data: { body: `e2e role message ${Date.now()}` },
  });
  expect(foremanSendRes.status()).toBe(201);

  await setRole(page, 'operator');
  const operatorInboxRes = await page.request.get('/api/messages/inbox');
  expect(operatorInboxRes.status()).toBe(200);
  const operatorInbox = await operatorInboxRes.json();
  expect(Array.isArray(operatorInbox?.items)).toBe(true);
  expect(typeof operatorInbox?.unread_count).toBe('number');

  const operatorMessagesRes = await page.request.get(`/api/messages/threads/${threadId}/messages`);
  expect(operatorMessagesRes.status()).toBe(200);
  const operatorMessages = await operatorMessagesRes.json();
  expect(Array.isArray(operatorMessages?.items)).toBe(true);
  expect(operatorMessages.items.length).toBeGreaterThan(0);

  const operatorSendRes = await page.request.post(`/api/messages/threads/${threadId}/send`, {
    data: { body: 'operator can send as a participant' },
  });
  expect(operatorSendRes.status()).toBe(201);
});

test('foreman can see company members available for messaging', async ({ page }) => {
  await setRole(page, 'foreman');

  const membersRes = await page.request.get('/api/company-members?excludeSelf=1');
  const membersBody = await membersRes.text();
  expect(membersRes.status(), membersBody).toBe(200);
  const members = (JSON.parse(membersBody)?.items ?? []) as Array<{ userId?: string; displayName?: string; role?: string }>;
  expect(Array.isArray(members)).toBe(true);

  const usersRes = await page.request.get('/api/messages/users');
  const usersBody = await usersRes.text();
  expect(usersRes.status(), usersBody).toBe(200);
  const users = (JSON.parse(usersBody)?.items ?? []) as Array<{ userId?: string; displayName?: string; role?: string }>;
  expect(Array.isArray(users)).toBe(true);
  expect(users.length).toBe(members.filter((member) => member.userId).length);
});
