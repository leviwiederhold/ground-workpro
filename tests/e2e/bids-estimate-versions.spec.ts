import { expect, test } from "@playwright/test";
import { loginViaUI } from "./helpers";

test("bids estimate versions with lock, history, diff, and risk totals", async ({ page }) => {
  await loginViaUI(page);

  const stamp = Date.now();
  const bidCreate = await page.request.post("/api/bids", {
    timeout: 30000,
    data: {
      title: `Estimate Version Bid ${stamp}`,
      stage: "estimating",
      probability: 55,
    },
  });
  const bidBody = await bidCreate.text();
  expect(bidCreate.status(), bidBody).toBe(200);
  const bidId = String(JSON.parse(bidBody)?.bid?.id ?? "");
  expect(bidId).toBeTruthy();

  const v1 = await page.request.post(`/api/bids/${bidId}/versions`, {
    timeout: 30000,
    data: {
      name: "v1",
      estimated_revenue: 100000,
      subtotal_cost: 70000,
      contingency_percent: 5,
      assumptions: [{ description: "Assume normal soil", amount: 0 }],
      exclusions: [{ description: "Excludes rock blasting", amount: 12000 }],
      alternates: [{ description: "Alternate dewatering", amount: 4500 }],
      risks: [{ title: "Permit delay", severity: "medium", cost_impact: 5000 }],
    },
  });
  const v1Body = await v1.text();
  expect(v1.status(), v1Body).toBe(201);
  const v1Id = String(JSON.parse(v1Body)?.item?.id ?? "");
  expect(v1Id).toBeTruthy();

  const v2 = await page.request.post(`/api/bids/${bidId}/versions`, {
    timeout: 30000,
    data: {
      name: "v2",
      estimated_revenue: 110000,
      subtotal_cost: 76000,
      contingency_percent: 7,
      assumptions: [{ description: "Assume 10-hour shifts", amount: 0 }],
      exclusions: [{ description: "Excludes utility relocation", amount: 16000 }],
      alternates: [{ description: "Alternate haul route", amount: 3200 }],
      risks: [
        { title: "Fuel spikes", severity: "high", cost_impact: 9000 },
        { title: "Rain delays", severity: "low", cost_impact: 2000 },
      ],
    },
  });
  const v2Body = await v2.text();
  expect(v2.status(), v2Body).toBe(201);
  const v2Id = String(JSON.parse(v2Body)?.item?.id ?? "");
  expect(v2Id).toBeTruthy();

  const lockRes = await page.request.patch(`/api/bids/${bidId}/versions/${v2Id}`, {
    timeout: 30000,
    data: { action: "lock" },
  });
  const lockBody = await lockRes.text();
  expect(lockRes.status(), lockBody).toBe(200);
  expect(JSON.parse(lockBody)?.item?.status).toBe("locked");

  const historyRes = await page.request.get(`/api/bids/${bidId}/versions`, { timeout: 30000 });
  const historyBody = await historyRes.text();
  expect(historyRes.status(), historyBody).toBe(200);
  const historyItems = JSON.parse(historyBody)?.items ?? [];
  expect(historyItems.length).toBeGreaterThanOrEqual(2);
  const lockedVersion = historyItems.find((row: { id: string }) => String(row.id) === v2Id);
  expect(lockedVersion?.status).toBe("locked");
  expect(Number(lockedVersion?.risk_totals?.total ?? 0)).toBeGreaterThan(0);

  const diffRes = await page.request.get(`/api/bids/${bidId}/versions/${v2Id}/diff?compareTo=${v1Id}`, { timeout: 30000 });
  const diffBody = await diffRes.text();
  expect(diffRes.status(), diffBody).toBe(200);
  const diff = JSON.parse(diffBody)?.item;
  expect(Number(diff?.delta?.total_cost ?? 0)).not.toBe(0);
  expect(Number(diff?.risk_totals?.to?.total ?? 0)).toBeGreaterThanOrEqual(11000);
});
