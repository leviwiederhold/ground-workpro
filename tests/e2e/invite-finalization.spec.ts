import { expect, test, type Browser, type Page } from "@playwright/test";

async function ensureOwner(page: Page) {
  // The E2E-only role mutator intentionally keeps its released-client legacy
  // contract; `admin` canonicalizes to Owner after the #96 migration.
  let response = await page.request.post("/api/test/set-role", { data: { role: "admin" } });
  if (response.status() === 403) {
    await page.request.post("/api/bootstrap");
    response = await page.request.post("/api/test/set-role", { data: { role: "admin" } });
  }
  const body = await response.text();
  expect(response.status(), body).toBe(200);
}

async function acceptThroughSignup(
  browser: Browser,
  inviteUrl: string,
  email: string,
  password: string
) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto(inviteUrl);
  await expect(page.getByText(/You're joining/)).toBeVisible();
  await page.locator('input[autocomplete="given-name"]').fill("Invite");
  await page.locator('input[autocomplete="family-name"]').fill("Manager");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/(?:$|setup|profile)/, { timeout: 30_000 });
  return { context, page };
}

test("invite finalizes once, disappears from Pending, and immediately joins Team", async ({
  page,
  browser,
}) => {
  await ensureOwner(page);

  const stamp = Date.now();
  const email = `invite-finalization-${stamp}@example.com`;
  const password = `InviteFinalize!${stamp}`;
  const invitationResponse = await page.request.post("/api/team/invitations", {
    data: {
      role: "manager",
      job_title: "Operations Manager",
      permissions: [
        { module_key: "team_management", access_level: "edit" },
        { module_key: "finance", access_level: "edit" },
      ],
    },
  });
  const invitationBody = await invitationResponse.text();
  expect(invitationResponse.status(), invitationBody).toBe(200);
  const invitation = JSON.parse(invitationBody)?.item;
  const invitationId = String(invitation?.id ?? "");
  const inviteToken = String(invitation?.invite_token ?? "");
  const inviteUrl = String(invitation?.invite_url ?? "");
  expect(invitationId).toBeTruthy();
  expect(inviteToken.length).toBeGreaterThanOrEqual(20);

  const ownerAccept = await page.request.post("/api/invite/accept", {
    data: { token: inviteToken },
  });
  expect(ownerAccept.status()).toBe(409);
  expect(await ownerAccept.json()).toMatchObject({ error: "owner_session" });

  const { context: invitedContext, page: invitedPage } = await acceptThroughSignup(
    browser,
    inviteUrl,
    email,
    password
  );

  const retry = await invitedPage.request.post("/api/invite/accept", {
    data: { token: inviteToken, full_name: "Invite Manager" },
  });
  const retryBody = await retry.text();
  expect(retry.status(), retryBody).toBe(200);

  await expect
    .poll(async () => {
      const pendingResponse = await page.request.get("/api/team/invitations");
      if (!pendingResponse.ok()) return "request-failed";
      const pending = await pendingResponse.json();
      return (pending?.items ?? []).some(
        (item: { id?: string }) => String(item.id ?? "") === invitationId
      )
        ? "pending"
        : "accepted";
    })
    .toBe("accepted");

  await expect
    .poll(async () => {
      const teamResponse = await page.request.get("/api/team?limit=100");
      if (!teamResponse.ok()) return "request-failed";
      const team = await teamResponse.json();
      const matches = (team?.items ?? []).filter(
        (item: { email?: string }) => String(item.email ?? "").toLowerCase() === email
      );
      return `${matches.length}:${String(matches[0]?.accountStatus ?? "missing")}:${String(
        matches[0]?.role ?? "missing"
      )}`;
    })
    .toBe("1:active:manager");

  const navResponse = await invitedPage.request.get("/api/nav");
  const navBody = await navResponse.text();
  expect(navResponse.status(), navBody).toBe(200);
  expect(String(JSON.parse(navBody)?.displayRole ?? "")).toBe("manager");

  await invitedContext.close();
});
