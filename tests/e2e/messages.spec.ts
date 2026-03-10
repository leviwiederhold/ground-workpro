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
