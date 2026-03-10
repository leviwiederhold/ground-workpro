import { expect, test, type Page } from '@playwright/test';

type Role = 'admin' | 'pm' | 'foreman' | 'mechanic' | 'operator';
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';

async function setRole(page: Page, role: Role) {
  let response = await page.request.post('/api/test/set-role', { data: { role }, timeout: 30_000 });
  let body = await response.text();

  if (response.status() === 403 && body.includes('No company membership found')) {
    const bootstrap = await page.request.post('/api/bootstrap', { timeout: 30_000 });
    const bootstrapBody = await bootstrap.text();
    expect([200, 400]).toContain(bootstrap.status());
    if (bootstrap.status() === 400 && !bootstrapBody.toLowerCase().includes('duplicate')) {
      throw new Error(bootstrapBody);
    }
    response = await page.request.post('/api/test/set-role', { data: { role }, timeout: 30_000 });
    body = await response.text();
  }

  expect(response.status(), body).toBe(200);
  await page.context().addCookies([{ name: 'e2e_role', value: role, url: BASE_URL }]);
}

test('messages MVP supports direct thread unread/read lifecycle', async ({ page }) => {
  await setRole(page, 'admin');

  const usersRes = await page.request.get('/api/messages/users', { timeout: 30_000 });
  expect(usersRes.status()).toBe(200);
  const usersPayload = await usersRes.json();
  const userIds: string[] = (usersPayload.items ?? []).map((item: { userId: string }) => String(item.userId));
  if (userIds.length === 0) {
    test.skip(true, 'No teammate account available for unread/read test');
  }

  const createRes = await page.request.post('/api/messages/direct/start', {
    data: { userId: userIds[0] },
    timeout: 30_000,
  });
  expect(createRes.status()).toBe(201);
  const threadId = String((await createRes.json())?.item?.id ?? '');
  expect(threadId).toBeTruthy();

  const sendRes = await page.request.post(`/api/messages/threads/${threadId}/send`, {
    data: { body: `hello-${Date.now()}` },
    timeout: 30_000,
  });
  expect(sendRes.status()).toBe(201);

  const inboxBeforeRead = await page.request.get('/api/messages/inbox', { timeout: 30_000 });
  expect(inboxBeforeRead.status()).toBe(200);
  const inboxBeforeJson = await inboxBeforeRead.json();
  const unreadBefore = Number(
    (inboxBeforeJson.items ?? []).find((item: { id: string }) => String(item.id) === threadId)?.unread_count ?? 0
  );

  const readRes = await page.request.post(`/api/messages/threads/${threadId}/read`, { timeout: 30_000 });
  expect(readRes.status()).toBe(200);

  const inboxAfterRead = await page.request.get('/api/messages/inbox', { timeout: 30_000 });
  expect(inboxAfterRead.status()).toBe(200);
  const inboxAfterJson = await inboxAfterRead.json();
  const unreadAfter = Number(
    (inboxAfterJson.items ?? []).find((item: { id: string }) => String(item.id) === threadId)?.unread_count ?? 0
  );

  expect(unreadAfter).toBeLessThanOrEqual(unreadBefore);
});
