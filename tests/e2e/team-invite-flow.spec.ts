import { expect, test, type Page } from "@playwright/test";
import { loginViaUI } from "./helpers";

async function setRoleAdmin(page: Page) {
  const response = await page.request.post("/api/test/set-role", { data: { role: "admin" } });
  const body = await response.text();
  expect(response.status(), body).toBe(200);
}

test("team invite flow requires role+permissions before link and supports pending actions", async ({ page }) => {
  await loginViaUI(page);
  await setRoleAdmin(page);

  const stamp = Date.now();
  const fullName = `Invite User ${stamp}`;
  const email = `invite-flow-${stamp}@example.com`;

  const createResponse = await page.request.post("/api/team/invitations", {
    data: {
      full_name: fullName,
      email,
      role: "foreman",
      permissions: [
        { module_key: "jobs", access_level: "view" },
        { module_key: "messages", access_level: "edit" },
        { module_key: "finance", access_level: "none" },
      ],
    },
  });
  const createBody = await createResponse.text();
  expect(createResponse.status(), createBody).toBe(200);
  const created = JSON.parse(createBody);
  const invitationId = String(created?.item?.id ?? "");
  expect(invitationId).toBeTruthy();
  expect(String(created?.item?.invite_url ?? "")).toContain("/signup?invite=1&token=");

  const listResponse = await page.request.get("/api/team/invitations");
  const listBody = await listResponse.text();
  expect(listResponse.status(), listBody).toBe(200);
  const listJson = JSON.parse(listBody);
  const pending = (listJson?.items ?? []).find((item: { id: string }) => String(item.id) === invitationId);
  expect(pending).toBeTruthy();
  expect(String(pending.email)).toBe(email);

  const regenerateResponse = await page.request.patch(`/api/team/invitations/${invitationId}`, {
    data: { regenerate: true },
  });
  const regenerateBody = await regenerateResponse.text();
  expect(regenerateResponse.status(), regenerateBody).toBe(200);

  const editResponse = await page.request.patch(`/api/team/invitations/${invitationId}`, {
    data: {
      role: "manager",
      permissions: [
        { module_key: "jobs", access_level: "edit" },
        { module_key: "messages", access_level: "edit" },
        { module_key: "finance", access_level: "view" },
      ],
    },
  });
  const editBody = await editResponse.text();
  expect(editResponse.status(), editBody).toBe(200);

  const deleteResponse = await page.request.delete(`/api/team/invitations/${invitationId}`);
  const deleteBody = await deleteResponse.text();
  expect(deleteResponse.status(), deleteBody).toBe(200);

  const afterDeleteResponse = await page.request.get("/api/team/invitations");
  const afterDeleteBody = await afterDeleteResponse.text();
  expect(afterDeleteResponse.status(), afterDeleteBody).toBe(200);
  const afterDeleteJson = JSON.parse(afterDeleteBody);
  expect((afterDeleteJson?.items ?? []).some((item: { id: string }) => String(item.id) === invitationId)).toBeFalsy();
});
