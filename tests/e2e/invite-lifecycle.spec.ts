import { expect, test, type Page } from "@playwright/test";
import { loginViaUI } from "./helpers";

async function setRoleAdmin(page: Page) {
  let response = await page.request.post("/api/test/set-role", { data: { role: "admin" } });
  let body = await response.text();

  if (response.status() === 403 && body.includes("No company membership found")) {
    const bootstrap = await page.request.post("/api/bootstrap");
    const bootstrapBody = await bootstrap.text();
    expect([200, 400]).toContain(bootstrap.status());
    if (bootstrap.status() === 400 && !bootstrapBody.toLowerCase().includes("duplicate")) {
      throw new Error(bootstrapBody);
    }
    response = await page.request.post("/api/test/set-role", { data: { role: "admin" } });
    body = await response.text();
  }

  expect(response.status(), body).toBe(200);
}

test("invite lifecycle transitions pending to active after employee accepts invite", async ({ page }) => {
  await loginViaUI(page);
  await setRoleAdmin(page);

  const stamp = Date.now();
  const employeeEmail = `invite-employee-${stamp}@example.com`;
  const employeeName = `Invite Employee ${stamp}`;
  const employeePassword = `InvitePass!${stamp}`;

  const createEmployeeRes = await page.request.post("/api/employees", {
    data: {
      name: employeeName,
      email: employeeEmail,
      role: "operator",
      status: "active",
    },
  });
  const createEmployeeText = await createEmployeeRes.text();
  expect(createEmployeeRes.status(), createEmployeeText).toBe(200);
  const createEmployeeJson = JSON.parse(createEmployeeText);
  const employeeId = String(createEmployeeJson?.employee?.id ?? "");
  expect(employeeId).toBeTruthy();

  const createInviteRes = await page.request.post("/api/invite/create", {
    data: {
      employeeId,
      email: employeeEmail,
      role: "operator",
    },
  });
  const createInviteText = await createInviteRes.text();
  expect(createInviteRes.status(), createInviteText).toBe(200);
  const createInviteJson = JSON.parse(createInviteText);
  const inviteToken = String(createInviteJson?.item?.token ?? "");
  expect(inviteToken.length).toBeGreaterThanOrEqual(20);

  const pendingTeamRes = await page.request.get("/api/team?limit=50");
  const pendingTeamText = await pendingTeamRes.text();
  expect(pendingTeamRes.status(), pendingTeamText).toBe(200);
  const pendingTeamJson = JSON.parse(pendingTeamText);
  const pendingMember = (pendingTeamJson?.items ?? []).find((item: { id: string }) => String(item.id) === employeeId);
  expect(pendingMember).toBeTruthy();
  expect(String(pendingMember.accountStatus)).toBe("pending");
  expect(String(pendingMember.role)).toBe("operator");

  const acceptInviteRes = await page.request.post("/api/test/accept-invite", {
    data: {
      token: inviteToken,
      email: employeeEmail,
      password: employeePassword,
    },
  });
  const acceptInviteText = await acceptInviteRes.text();
  expect(acceptInviteRes.status(), acceptInviteText).toBe(200);

  await expect
    .poll(
      async () => {
        const activeTeamRes = await page.request.get("/api/team?limit=50");
        if (!activeTeamRes.ok()) return "missing";
        const activeTeamJson = await activeTeamRes.json();
        const activeMember = (activeTeamJson?.items ?? []).find(
          (item: { id: string }) => String(item.id) === employeeId
        );
        return `${String(activeMember?.accountStatus ?? "missing")}::${String(activeMember?.role ?? "missing")}`;
      },
      { timeout: 30_000 }
    )
    .toBe("active::operator");
});

test("team pending invitation is accepted and removed from pending for new and existing user", async ({ page }) => {
  await loginViaUI(page);
  await setRoleAdmin(page);

  const stamp = Date.now();
  const email = `team-invite-${stamp}@example.com`;
  const password = `InvitePass!${stamp}`;

  const createPendingRes = await page.request.post("/api/team/invitations", {
    data: {
      full_name: `Team Invite ${stamp}`,
      email,
      role: "manager",
      permissions: [{ module_key: "jobs", access_level: "edit" }],
    },
  });
  const createPendingText = await createPendingRes.text();
  expect(createPendingRes.status(), createPendingText).toBe(200);
  const createPendingJson = JSON.parse(createPendingText);
  const invitationId = String(createPendingJson?.item?.id ?? "");
  const inviteToken = String(createPendingJson?.item?.invite_token ?? "");
  expect(invitationId).toBeTruthy();
  expect(inviteToken.length).toBeGreaterThanOrEqual(20);

  const pendingBeforeRes = await page.request.get("/api/team/invitations");
  const pendingBeforeText = await pendingBeforeRes.text();
  expect(pendingBeforeRes.status(), pendingBeforeText).toBe(200);
  const pendingBeforeJson = JSON.parse(pendingBeforeText);
  expect((pendingBeforeJson?.items ?? []).some((item: { id: string }) => String(item.id) === invitationId)).toBeTruthy();

  const acceptNewUserRes = await page.request.post("/api/test/accept-invite", {
    data: {
      token: inviteToken,
      email,
      password,
    },
  });
  const acceptNewUserText = await acceptNewUserRes.text();
  expect(acceptNewUserRes.status(), acceptNewUserText).toBe(200);

  await expect
    .poll(
      async () => {
        const pendingAfterRes = await page.request.get("/api/team/invitations");
        if (!pendingAfterRes.ok()) return "pending";
        const pendingAfterJson = await pendingAfterRes.json();
        return (pendingAfterJson?.items ?? []).some((item: { id: string }) => String(item.id) === invitationId)
          ? "pending"
          : "accepted";
      },
      { timeout: 30_000 }
    )
    .toBe("accepted");

  await expect
    .poll(
      async () => {
        const teamRes = await page.request.get("/api/team?limit=100");
        if (!teamRes.ok()) return "missing";
        const teamJson = await teamRes.json();
        const member = (teamJson?.items ?? []).find(
          (item: { email?: string }) => String(item.email ?? "").toLowerCase() === email
        );
        return String(member?.accountStatus ?? "missing");
      },
      { timeout: 30_000 }
    )
    .toBe("active");

  const createSecondPendingRes = await page.request.post("/api/team/invitations", {
    data: {
      full_name: `Team Invite Existing ${stamp}`,
      email,
      role: "manager",
      permissions: [{ module_key: "jobs", access_level: "edit" }],
    },
  });
  const createSecondPendingText = await createSecondPendingRes.text();
  expect(createSecondPendingRes.status(), createSecondPendingText).toBe(200);
  const createSecondPendingJson = JSON.parse(createSecondPendingText);
  const secondInvitationId = String(createSecondPendingJson?.item?.id ?? "");
  const secondInviteToken = String(createSecondPendingJson?.item?.invite_token ?? "");
  expect(secondInvitationId).toBeTruthy();
  expect(secondInviteToken.length).toBeGreaterThanOrEqual(20);

  const acceptExistingUserRes = await page.request.post("/api/test/accept-invite", {
    data: {
      token: secondInviteToken,
      email,
      password,
    },
  });
  const acceptExistingUserText = await acceptExistingUserRes.text();
  expect(acceptExistingUserRes.status(), acceptExistingUserText).toBe(200);

  await expect
    .poll(
      async () => {
        const pendingAfterSecondRes = await page.request.get("/api/team/invitations");
        if (!pendingAfterSecondRes.ok()) return "pending";
        const pendingAfterSecondJson = await pendingAfterSecondRes.json();
        return (pendingAfterSecondJson?.items ?? []).some((item: { id: string }) => String(item.id) === secondInvitationId)
          ? "pending"
          : "accepted";
      },
      { timeout: 30_000 }
    )
    .toBe("accepted");
});
