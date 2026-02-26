import { expect, test, type Page } from "@playwright/test";
import { loginViaUI } from "./helpers";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";

async function setRole(page: Page, role: "admin" | "pm" | "foreman" | "mechanic" | "operator") {
  await page.context().addCookies([{ name: "e2e_role", value: role, url: BASE_URL }]);
}

test("bids executive analytics + handoff export + role visibility", async ({ page }) => {
  await loginViaUI(page);
  await setRole(page, "admin");

  const stamp = Date.now();
  const createOpen = await page.request.post("/api/bids", {
    data: { title: `Exec Open ${stamp}`, stage: "estimating", probability: 50 },
  });
  const openBodyText = await createOpen.text();
  expect(createOpen.status(), openBodyText).toBe(200);
  const openBidId = String(JSON.parse(openBodyText)?.bid?.id ?? "");
  expect(openBidId).toBeTruthy();

  const createWon = await page.request.post("/api/bids", {
    data: { title: `Exec Won ${stamp}`, stage: "estimating", probability: 90 },
  });
  const wonBodyText = await createWon.text();
  expect(createWon.status(), wonBodyText).toBe(200);
  const wonBidId = String(JSON.parse(wonBodyText)?.bid?.id ?? "");
  expect(wonBidId).toBeTruthy();

  const analytics = await page.request.get("/api/bids/analytics");
  const analyticsBodyText = await analytics.text();
  expect(analytics.status(), analyticsBodyText).toBe(200);
  const analyticsBody = JSON.parse(analyticsBodyText);
  expect(analyticsBody?.item?.visible).toBeTruthy();
  expect(Number(analyticsBody?.item?.counts?.open ?? 0)).toBeGreaterThanOrEqual(2);
  expect(Number(analyticsBody?.item?.win_rate_percent ?? 0)).toBeGreaterThanOrEqual(0);

  const handoffJson = await page.request.get(`/api/bids/${wonBidId}/handoff?format=json`);
  const handoffJsonBody = await handoffJson.text();
  expect(handoffJson.status(), handoffJsonBody).toBe(200);
  const handoffPayload = JSON.parse(handoffJsonBody);
  expect(String(handoffPayload?.item?.bid?.id ?? "")).toBe(wonBidId);

  const handoffPdf = await page.request.get(`/api/bids/${wonBidId}/handoff?format=pdf`);
  expect(handoffPdf.status()).toBe(200);
  expect(handoffPdf.headers()["content-type"]).toContain("application/pdf");

  await setRole(page, "foreman");
  const foremanAnalytics = await page.request.get("/api/bids/analytics");
  const foremanBodyText = await foremanAnalytics.text();
  expect(foremanAnalytics.status(), foremanBodyText).toBe(200);
  const foremanBody = JSON.parse(foremanBodyText);
  expect(foremanBody?.item?.visible).toBeFalsy();

  await setRole(page, "admin");
});
