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
  await page.goto(inviteUrl);
  const fillInviteForm = async () => {
    await page.locator('input[autocomplete="given-name"]').fill('Field');
    await page.locator('input[autocomplete="family-name"]').fill('Staff');
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
  };
  await fillInviteForm();
  await page.getByRole('button', { name: 'Create account' }).click();
  const ownerProtection = page.getByRole('button', {
    name: 'Sign out and accept as team member',
  });
  await expect
    .poll(
      async () =>
        (await ownerProtection.isVisible().catch(() => false)) ||
        new URL(page.url()).pathname !== '/signup',
      { timeout: 30_000 }
    )
    .toBe(true);
  if (await ownerProtection.isVisible().catch(() => false)) {
    await ownerProtection.click();
    await fillInviteForm();
    await page.getByRole('button', { name: 'Create account' }).click();
  }
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 30_000 })
    .toMatch(/^\/(?:web-access-restricted|$|setup|profile)/);
  return { context, page };
}

test('legacy field staff invite is accepted and displayed as Team Member', async ({ page, browser }) => {
  await loginViaUI(page);
  await setRole(page, 'admin');

  const stamp = Date.now();
  const email = `fieldstaff-${stamp}@example.com`;
  const password = `FieldPass!${stamp}`;

  const invitationResponse = await page.request.post('/api/team/invitations', {
    data: {
      full_name: `Field Staff ${stamp}`,
      email,
      role: 'fieldstaff',
      permissions: [
        { module_key: 'messages', access_level: 'view' },
        { module_key: 'daily_reports', access_level: 'edit' },
        { module_key: 'safety', access_level: 'edit' },
      ],
    },
  });
  const invitationBody = await invitationResponse.text();
  expect(invitationResponse.status(), invitationBody).toBe(200);
  const invitationJson = JSON.parse(invitationBody);
  const invitationId = String(invitationJson?.item?.id ?? '');
  const inviteUrl = String(invitationJson?.item?.invite_url ?? '');
  expect(invitationId).toBeTruthy();
  expect(inviteUrl).toContain('/signup?invite=1&token=');

  const { context, page: invitedPage } = await signupFromInvite(browser, inviteUrl, email, password);

  await expect(invitedPage).toHaveURL(/\/web-access-restricted/);
  await expect(invitedPage.getByRole('heading', { name: 'Use the Groundwork Pro mobile app' })).toBeVisible();

  const navResponse = await invitedPage.request.get('/api/nav');
  const navBody = await navResponse.text();
  expect(navResponse.status(), navBody).toBe(200);
  const navJson = JSON.parse(navBody);
  expect(String(navJson?.displayRole ?? '')).toBe('team_member');

  // Other role specs deliberately mutate the shared E2E actor. Reassert the
  // Owner role before reading the company-scoped pending and Team collections.
  await loginViaUI(page);
  await setRole(page, 'admin');

  await expect
    .poll(
      async () => {
        const pendingResponse = await page.request.get('/api/team/invitations');
        if (!pendingResponse.ok()) return 'pending';
        const pendingJson = await pendingResponse.json();
        return (pendingJson?.items ?? []).some((item: { id?: string }) => String(item.id ?? '') === invitationId)
          ? 'pending'
          : 'accepted';
      },
      { timeout: 30_000 }
    )
    .toBe('accepted');

  await expect
    .poll(
      async () => {
        const teamResponse = await page.request.get('/api/team?limit=100');
        if (!teamResponse.ok()) return 'missing';
        const teamJson = await teamResponse.json();
        const member = (teamJson?.items ?? []).find(
          (item: { email?: string }) => String(item.email ?? '').toLowerCase() === email
        );
        if (!member) return 'missing';
        return `${String(member.accountStatus ?? '')}::${String(member.role ?? '')}`;
      },
      { timeout: 30_000 }
    )
    .toBe('active::team_member');

  await context.close();
});
