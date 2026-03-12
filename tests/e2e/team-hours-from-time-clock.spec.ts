import { expect, test } from "@playwright/test";
import { getE2ECreds, loginViaUI } from "./helpers";

test("team hours this week mirrors time clock weekly hours for the current user", async ({ page }) => {
  await loginViaUI(page);
  const { email } = getE2ECreds();

  const ensureClockIn = await page.request.post("/api/time-clock/clock-in", { timeout: 30_000 });
  expect([200, 409]).toContain(ensureClockIn.status());

  const timeClockRes = await page.request.get("/api/time-clock", { timeout: 30_000 });
  const timeClockBody = await timeClockRes.text();
  expect(timeClockRes.status(), timeClockBody).toBe(200);
  const timeClock = JSON.parse(timeClockBody)?.item ?? {};

  const teamRes = await page.request.get("/api/team?limit=100", { timeout: 30_000 });
  const teamBody = await teamRes.text();
  expect(teamRes.status(), teamBody).toBe(200);
  const teamItems = JSON.parse(teamBody)?.items ?? [];
  const me = teamItems.find((item: { email?: string }) =>
    String(item.email ?? "").trim().toLowerCase() === String(email).trim().toLowerCase()
  );
  expect(me).toBeTruthy();

  const teamHours = Number(me?.hoursThisWeek ?? 0);
  const clockHours = Number(timeClock?.weekHours ?? 0);
  expect(Math.abs(teamHours - clockHours)).toBeLessThanOrEqual(0.1);

  if (String(timeClock?.status) === "clocked_in") {
    expect(String(me?.clockedInAt ?? "")).not.toEqual("");
  }
});
