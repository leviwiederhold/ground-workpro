import { expect, test, type Page } from "@playwright/test";
import { loginViaUI } from "./helpers";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";

async function forceRole(page: Page, role: "admin" | "pm" | "foreman") {
  let response = await page.request.post("/api/test/set-role", { data: { role } });
  let body = await response.text();
  if (response.status() === 403 && body.includes("No company membership found")) {
    await page.request.post("/api/bootstrap");
    response = await page.request.post("/api/test/set-role", { data: { role } });
    body = await response.text();
  }
  expect(response.status(), body).toBe(200);
  await page.context().addCookies([{ name: "e2e_role", value: role, url: BASE_URL }]);
}

test("group chat creation works and group messages show sender identity", async ({ page }) => {
  await loginViaUI(page);
  await forceRole(page, "admin");

  const stamp = Date.now();
  const teammateAEmail = `group-a-${stamp}@example.com`;
  const teammateBEmail = `group-b-${stamp}@example.com`;
  const teammateAPassword = `GroupA!${stamp}`;
  const teammateBPassword = `GroupB!${stamp}`;

  const createEmployee = async (name: string, email: string, role: "PM" | "Foreman") => {
    const response = await page.request.post("/api/employees", {
      data: { name, email, role, status: "active" },
    });
    const body = await response.text();
    expect(response.status(), body).toBe(200);
    return String(JSON.parse(body)?.employee?.id ?? "");
  };

  const inviteAndAccept = async (
    employeeId: string,
    email: string,
    password: string,
    role: "manager" | "foreman"
  ) => {
    const inviteResponse = await page.request.post("/api/invite/create", {
      data: { employeeId, email, role },
    });
    const inviteBody = await inviteResponse.text();
    expect(inviteResponse.status(), inviteBody).toBe(200);
    const token = String(JSON.parse(inviteBody)?.item?.token ?? "");
    expect(token).toBeTruthy();

    const acceptResponse = await page.request.post("/api/test/accept-invite", {
      data: { token, email, password },
    });
    const acceptBody = await acceptResponse.text();
    expect(acceptResponse.status(), acceptBody).toBe(200);
    return String(JSON.parse(acceptBody)?.item?.userId ?? "");
  };

  const teammateAEmployeeId = await createEmployee(`Group PM ${stamp}`, teammateAEmail, "PM");
  const teammateBEmployeeId = await createEmployee(`Group PM B ${stamp}`, teammateBEmail, "PM");
  const teammateAUserId = await inviteAndAccept(teammateAEmployeeId, teammateAEmail, teammateAPassword, "manager");
  const teammateBUserId = await inviteAndAccept(teammateBEmployeeId, teammateBEmail, teammateBPassword, "manager");
  expect(teammateAUserId).toBeTruthy();
  expect(teammateBUserId).toBeTruthy();

  const directRes = await page.request.post("/api/messages/direct/start", {
    data: { userId: teammateAUserId },
  });
  const directBody = await directRes.text();
  expect(directRes.status(), directBody).toBe(201);
  expect(String(JSON.parse(directBody)?.item?.kind ?? "")).toBe("direct");

  const groupCreateRes = await page.request.post("/api/messages/channels", {
    data: {
      name: `Ops Group ${stamp}`,
      memberUserIds: [teammateAUserId, teammateBUserId, teammateAUserId],
    },
  });
  const groupCreateBody = await groupCreateRes.text();
  expect(groupCreateRes.status(), groupCreateBody).toBe(201);
  const groupCreateJson = JSON.parse(groupCreateBody);
  const groupThreadId = String(groupCreateJson?.item?.id ?? "");
  expect(groupThreadId).toBeTruthy();
  expect(String(groupCreateJson?.item?.kind ?? "")).toBe("group");
  expect(Number(groupCreateJson?.item?.member_count ?? 0)).toBe(3);

  const membersRes = await page.request.get(`/api/messages/channels/${groupThreadId}/members`);
  const membersBody = await membersRes.text();
  expect(membersRes.status(), membersBody).toBe(200);
  const members = (JSON.parse(membersBody)?.items ?? []) as Array<{ userId?: string }>;
  expect(members.some((member) => String(member.userId ?? "") === teammateAUserId)).toBe(true);
  expect(members.some((member) => String(member.userId ?? "") === teammateBUserId)).toBe(true);
  expect(members.length).toBe(3);

  const sendGroupRes = await page.request.post(`/api/messages/threads/${groupThreadId}/send`, {
    data: { body: `group-message-${stamp}` },
  });
  const sendGroupBody = await sendGroupRes.text();
  expect(sendGroupRes.status(), sendGroupBody).toBe(201);

  const adminMessagesRes = await page.request.get(`/api/messages/threads/${groupThreadId}/messages`);
  const adminMessagesBody = await adminMessagesRes.text();
  expect(adminMessagesRes.status(), adminMessagesBody).toBe(200);
  const adminMessages = (JSON.parse(adminMessagesBody)?.items ?? []) as Array<{
    body?: string;
    sender_display_name?: string;
  }>;
  const sentRow = adminMessages.find((row) => String(row.body ?? "") === `group-message-${stamp}`);
  expect(String(sentRow?.sender_display_name ?? "").trim()).toBeTruthy();
  const senderName = String(sentRow?.sender_display_name ?? "").trim();

  await page.goto("/");
  await page.getByTestId("nav-messages").click();
  await expect(page.getByTestId(`messages-channel-${groupThreadId}`)).toBeVisible();
  await page.getByTestId(`messages-channel-${groupThreadId}`).click();
  await expect(page.getByTestId("messages-active-channel")).toBeVisible();
  await expect(page.getByText(senderName, { exact: true })).toBeVisible();

  const loginAsParticipant = async (
    email: string,
    password: string,
    role: "pm" | "foreman",
    actorPage: Page
  ) => {
    const response = await actorPage.request.post("/api/test/login", {
      data: { email, password },
    });
    const body = await response.text();
    expect(response.status(), body).toBe(200);
    await forceRole(actorPage, role);
  };

  await loginAsParticipant(teammateAEmail, teammateAPassword, "pm", page);
  const participantAInboxRes = await page.request.get("/api/messages/inbox");
  const participantAInboxBody = await participantAInboxRes.text();
  expect(participantAInboxRes.status(), participantAInboxBody).toBe(200);
  const participantAInbox = (JSON.parse(participantAInboxBody)?.items ?? []) as Array<{ id?: string; kind?: string }>;
  expect(participantAInbox.some((item) => String(item.id ?? "") === groupThreadId && String(item.kind ?? "") === "group")).toBe(true);
  const participantAMessagesRes = await page.request.get(`/api/messages/threads/${groupThreadId}/messages`);
  expect(participantAMessagesRes.status(), await participantAMessagesRes.text()).toBe(200);
  const participantAReplyRes = await page.request.post(`/api/messages/threads/${groupThreadId}/send`, {
    data: { body: `reply-message-${stamp}` },
  });
  expect(participantAReplyRes.status(), await participantAReplyRes.text()).toBe(201);
});
