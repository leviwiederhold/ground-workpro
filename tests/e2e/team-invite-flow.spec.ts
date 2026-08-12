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

  const createResponse = await page.request.post("/api/team/invitations", {
    data: {
      role: "crew_lead",
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
  expect(String(pending.role)).toBe("crew_lead");
  const pendingPermissions = new Map(
    ((pending?.permissions ?? []) as Array<{ module_key: string; access_level: string }>).map((row) => [row.module_key, row.access_level])
  );
  for (const moduleKey of [
    "jobs",
    "fleet",
    "maintenance",
    "daily_reports",
    "safety",
    "messages",
    "inventory",
    "reports",
    "vendors",
    "documents",
    "training",
    "finance",
    "integrations",
    "team_management",
  ]) {
    expect(pendingPermissions.has(moduleKey)).toBeTruthy();
  }
  expect(pendingPermissions.get("finance")).toBe("none");
  expect(pendingPermissions.get("reports")).toBe("none");

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
