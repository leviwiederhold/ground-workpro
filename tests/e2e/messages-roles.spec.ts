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

test('messages channels are scoped and permissions are enforced', async ({ page }) => {
  const stamp = Date.now();

  await setRole(page, 'admin');

  const createChannelRes = await page.request.post('/api/messages/channels', {
    data: { name: `e2e-msg-role-${stamp}` },
  });
  expect(createChannelRes.status()).toBe(201);
  const channel = (await createChannelRes.json())?.item;
  const channelId = String(channel?.id ?? '');
  expect(channelId).toBeTruthy();

  await setRole(page, 'foreman');
  const foremanSendRes = await page.request.post(`/api/messages/channels/${channelId}/send`, {
    data: { body: `e2e role message ${stamp}` },
  });
  expect(foremanSendRes.status()).toBe(201);

  await setRole(page, 'operator');

  const operatorChannelsRes = await page.request.get('/api/messages/channels');
  expect(operatorChannelsRes.status()).toBe(200);
  const operatorChannels = await operatorChannelsRes.json();
  expect(Array.isArray(operatorChannels?.items)).toBe(true);
  expect(typeof operatorChannels?.unread_count).toBe('number');
  expect(operatorChannels.items.some((row: { id: string }) => String(row.id) === channelId)).toBe(true);

  const operatorMessagesRes = await page.request.get(`/api/messages/channels/${channelId}/messages`);
  expect(operatorMessagesRes.status()).toBe(200);
  const operatorMessages = await operatorMessagesRes.json();
  expect(Array.isArray(operatorMessages?.items)).toBe(true);
  expect(operatorMessages.items.length).toBeGreaterThan(0);

  const operatorCreateChannelRes = await page.request.post('/api/messages/channels', {
    data: { name: `operator-create-${stamp}`, memberUserIds: [] },
  });
  expect(operatorCreateChannelRes.status()).toBe(201);

  const operatorSendRes = await page.request.post(`/api/messages/channels/${channelId}/send`, {
    data: { body: 'operator can send as a member' },
  });
  expect(operatorSendRes.status()).toBe(201);
});
