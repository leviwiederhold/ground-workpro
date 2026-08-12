import { expect, test, type Page } from "@playwright/test";
import { loginViaUI } from "./helpers";

const canonicalRoles = [
  "owner",
  "administrator",
  "manager",
  "crew_lead",
  "team_member",
] as const;

test.skip(
  process.env.E2E_CANONICAL_ROLE_MIGRATION !== "1",
  "Requires the canonical team-role migration to be applied to the target database"
);

async function setRoleAdmin(page: Page) {
  const response = await page.request.post("/api/test/set-role", {
    data: { role: "admin" },
  });
  expect(response.status(), await response.text()).toBe(200);
}

test("every canonical role uses the same invite creation and acceptance contract", async ({ page }) => {
  await loginViaUI(page);
  await setRoleAdmin(page);

  const stamp = Date.now();

  for (const [index, role] of canonicalRoles.entries()) {
    const email = `canonical-${role}-${stamp}@example.com`;
    const password = `CanonicalPass!${stamp}${index}`;

    const createResponse = await page.request.post("/api/team/invitations", {
      data: {
        role,
        job_title: role === "team_member" ? "Equipment Operator" : undefined,
      },
    });
    const createBody = await createResponse.text();
    expect(createResponse.status(), createBody).toBe(200);
    const created = JSON.parse(createBody)?.item;
    expect(created?.role).toBe(role);
    expect(String(created?.invite_token ?? "").length).toBeGreaterThanOrEqual(20);

    const acceptResponse = await page.request.post("/api/test/accept-invite", {
      data: {
        token: created.invite_token,
        email,
        password,
      },
    });
    expect(acceptResponse.status(), await acceptResponse.text()).toBe(200);

    await expect
      .poll(async () => {
        const teamResponse = await page.request.get("/api/team?limit=100");
        if (!teamResponse.ok()) return "missing";
        const items = (await teamResponse.json())?.items ?? [];
        const matches = items.filter(
          (item: { email?: string }) =>
            String(item.email ?? "").toLowerCase() === email
        );
        if (matches.length !== 1) return `count:${matches.length}`;
        return `${String(matches[0].accountStatus)}::${String(matches[0].role)}`;
      })
      .toBe(`active::${role}`);
  }
});
