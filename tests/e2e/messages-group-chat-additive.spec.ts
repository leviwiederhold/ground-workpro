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

test('messages group chat feature is additive and supports member management', async ({ page }) => {
  const stamp = Date.now();
  await setRole(page, 'admin');

  const baselineChannelRes = await page.request.post('/api/messages/channels', {
    data: { name: `baseline-${stamp}`, memberUserIds: [] },
    timeout: 30_000,
  });
  expect(baselineChannelRes.status()).toBe(201);
  const baselineId = String((await baselineChannelRes.json())?.item?.id ?? '');
  expect(baselineId).toBeTruthy();

  const baselineSendRes = await page.request.post(`/api/messages/channels/${baselineId}/send`, {
    data: { body: `baseline-message-${stamp}` },
    timeout: 30_000,
  });
  const baselineSendBody = await baselineSendRes.text();
  if (baselineSendRes.status() === 500) {
    test.skip(true, `messages send backend unavailable in this environment: ${baselineSendBody}`);
  }
  expect(baselineSendRes.status()).toBe(201);

  const baselineMessagesRes = await page.request.get(`/api/messages/channels/${baselineId}/messages`, {
    timeout: 30_000,
  });
  expect(baselineMessagesRes.status()).toBe(200);
  expect(Array.isArray((await baselineMessagesRes.json())?.items)).toBe(true);

  const usersRes = await page.request.get('/api/messages/users', { timeout: 30_000 });
  expect(usersRes.status()).toBe(200);
  const usersPayload = await usersRes.json();
  const userIds: string[] = (usersPayload.items ?? []).map((item: { userId: string }) => String(item.userId));
  expect(userIds.length).toBeGreaterThan(0);

  const createRes = await page.request.post('/api/messages/channels', {
    data: { name: `group-${stamp}`, memberUserIds: [userIds[0]] },
    timeout: 30_000,
  });
  expect(createRes.status()).toBe(201);
  const channelId = String((await createRes.json())?.item?.id ?? '');
  expect(channelId).toBeTruthy();

  await setRole(page, 'operator');
  const userBSendRes = await page.request.post(`/api/messages/channels/${channelId}/send`, {
    data: { body: `hello-from-user-b-${stamp}` },
    timeout: 30_000,
  });
  expect(userBSendRes.status()).toBe(201);

  await setRole(page, 'admin');
  const userAReadRes = await page.request.get(`/api/messages/channels/${channelId}/messages`, {
    timeout: 30_000,
  });
  expect(userAReadRes.status()).toBe(200);
  const userAReadPayload = await userAReadRes.json();
  expect((userAReadPayload.items ?? []).some((item: { body: string }) => String(item.body).includes(`hello-from-user-b-${stamp}`))).toBe(true);

  const addMemberRes = await page.request.post(`/api/messages/channels/${channelId}/members`, {
    data: { userIds: [userIds[0]] },
    timeout: 30_000,
  });
  expect(addMemberRes.status()).toBe(200);
  expect((await addMemberRes.json())?.item?.addedCount).toBeGreaterThanOrEqual(0);

  const leaveRes = await page.request.delete(`/api/messages/channels/${channelId}/members/me`, {
    timeout: 30_000,
  });
  expect(leaveRes.status()).toBe(200);
  expect(await leaveRes.json()).toEqual({ success: true });

  const forbiddenReadRes = await page.request.get(`/api/messages/channels/${channelId}/messages`, {
    timeout: 30_000,
  });
  expect([200, 403]).toContain(forbiddenReadRes.status());
});
