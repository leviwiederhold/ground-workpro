import { expect, test, type Browser, type Page } from '@playwright/test';
import { loginViaUI } from './helpers';

async function setRole(page: Page, role: 'admin' | 'pm' | 'foreman' | 'mechanic' | 'operator') {
  const response = await page.request.post('/api/test/set-role', { data: { role } });
  const body = await response.text();
  expect(response.status(), body).toBe(200);
}

async function signupFromInvite(browser: Browser, inviteUrl: string, email: string, password: string) {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  // Employee profile/setup routes are mobile-app surfaces now. Enter through
  // the native route so the server carries the native session marker forward.
  await page.goto('/native?gw_native=1');
  await page.goto(inviteUrl);
  await page.locator('input[autocomplete="given-name"]').fill('Avatar');
  await page.locator('input[autocomplete="family-name"]').fill('User');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/\/($|setup|profile)/, { timeout: 30_000 });
  return { context, page };
}

async function runAvatarFlow(params: {
  page: Page;
  browser: Browser;
  invitedRole: 'operator' | 'foreman';
  avatarName: string;
  avatarBuffer: Buffer;
}) {
  const { page, browser, invitedRole, avatarName, avatarBuffer } = params;
  await loginViaUI(page);
  await setRole(page, 'admin');

  const stamp = Date.now();
  const email = `profile-avatar-${invitedRole}-${stamp}@example.com`;
  const password = `ProfilePass!${stamp}`;

  const invitationResponse = await page.request.post('/api/team/invitations', {
    data: {
      full_name: `Avatar User ${stamp}`,
      email,
      role: invitedRole,
      permissions: [
        { module_key: 'messages', access_level: 'edit' },
        { module_key: 'safety', access_level: 'edit' },
      ],
    },
  });
  const invitationBody = await invitationResponse.text();
  expect(invitationResponse.status(), invitationBody).toBe(200);
  const inviteUrl = String(JSON.parse(invitationBody)?.item?.invite_url ?? '');
  expect(inviteUrl).toContain('/signup?invite=1&token=');

  const { context, page: invitedPage } = await signupFromInvite(browser, inviteUrl, email, password);

  await invitedPage.waitForURL(/\/setup/, { timeout: 30_000 });
  await invitedPage.locator('a[href*="/profile"]').first().click();
  await invitedPage.waitForURL(/\/profile\?onboarding=1/, { timeout: 30_000 });

  await invitedPage.locator('input[type="file"]').setInputFiles({
    name: 'bad-avatar.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not-an-image', 'utf8'),
  });
  await expect(invitedPage.getByText('Only PNG, JPEG, WEBP, or SVG avatars are supported.').first()).toBeVisible();

  const fullNameInput = invitedPage.locator('label').filter({ hasText: 'Full Name' }).locator('input');
  await fullNameInput.fill('');
  await invitedPage.getByRole('button', { name: 'Save Profile' }).click();
  await expect(invitedPage.getByText('Full name is required.').first()).toBeVisible();

  await fullNameInput.fill(`Avatar User ${stamp}`);
  await invitedPage.getByPlaceholder('(555) 123-4567').fill('5551234567');
  await invitedPage.getByRole('combobox').selectOption('America/New_York');
  await invitedPage.locator('input[type="file"]').setInputFiles({
    name: avatarName,
    mimeType: 'image/svg+xml',
    buffer: avatarBuffer,
  });
  await invitedPage.getByRole('button', { name: 'Save Profile' }).click();
  await invitedPage.waitForURL(/\/setup/, { timeout: 30_000 });

  await expect
    .poll(
      async () => {
        const teamResponse = await page.request.get('/api/team?limit=100');
        if (!teamResponse.ok()) return '';
        const teamJson = await teamResponse.json();
        const member = (teamJson?.items ?? []).find(
          (item: { email?: string }) => String(item.email ?? '').toLowerCase() === email
        );
        return String(member?.avatarUrl ?? '');
      },
      { timeout: 30_000 }
    )
    .not.toBe('');

  const companyMembersResponse = await page.request.get('/api/company-members?excludeSelf=0');
  const companyMembersBody = await companyMembersResponse.text();
  expect(companyMembersResponse.status(), companyMembersBody).toBe(200);
  const companyMembers = JSON.parse(companyMembersBody)?.items ?? [];
  const companyMember = companyMembers.find((item: { email?: string }) => String(item.email ?? '').toLowerCase() === email);
  expect(String(companyMember?.avatarUrl ?? '')).not.toBe('');

  const messagesUsersResponse = await page.request.get('/api/messages/users');
  const messagesUsersBody = await messagesUsersResponse.text();
  expect(messagesUsersResponse.status(), messagesUsersBody).toBe(200);
  const messagesUsers = JSON.parse(messagesUsersBody)?.items ?? [];
  const messageUser = messagesUsers.find((item: { displayName?: string }) => String(item.displayName ?? '') === `Avatar User ${stamp}`);
  expect(String(messageUser?.avatarUrl ?? '')).not.toBe('');

  await context.close();
}

test('invited operator profile shows field errors and avatar updates across team and messaging surfaces', async ({ page, browser }) => {
  await runAvatarFlow({
    page,
    browser,
    invitedRole: 'operator',
    avatarName: 'avatar.svg',
    avatarBuffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#0f766e"/></svg>',
      'utf8'
    ),
  });
});

test('invited foreman profile accepts a sub-2MB avatar that expands past the old base64 string limit', async ({ page, browser }) => {
  const largeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><text x="0" y="16">${'A'.repeat(1_550_000)}</text></svg>`;
  await runAvatarFlow({
    page,
    browser,
    invitedRole: 'foreman',
    avatarName: 'foreman-avatar.svg',
    avatarBuffer: Buffer.from(largeSvg, 'utf8'),
  });
});
