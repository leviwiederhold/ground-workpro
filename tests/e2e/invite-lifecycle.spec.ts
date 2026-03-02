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
        return String(activeMember?.accountStatus ?? "missing");
      },
      { timeout: 30_000 }
    )
    .toBe("active");
});
