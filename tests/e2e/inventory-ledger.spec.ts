import { expect, test } from "@playwright/test";
import { loginViaUI } from "./helpers";

test("inventory ledger receive/issue/adjust/transfer persists balances", async ({ page }) => {
  await loginViaUI(page);

  const stamp = Date.now();
  const itemName = `Ledger Item ${stamp}`;

  const createItemRes = await page.request.post("/api/inventory", {
    data: {
      name: itemName,
      category: "Materials",
      unit: "EA",
      quantity_on_hand: 10,
      qty_reserved: 0,
      reorder_point: 2,
      unit_cost: 5,
      location: "Yard A",
      status: "active",
    },
  });
  expect(createItemRes.status()).toBe(200);
  const createItemJson = await createItemRes.json();
  const itemId = String(createItemJson?.item?.id || "");
  expect(itemId).toBeTruthy();

  const jobsRes = await page.request.get("/api/jobs");
  expect(jobsRes.status()).toBe(200);
  const jobsJson = await jobsRes.json();
  const jobId = jobsJson?.items?.[0]?.id ?? jobsJson?.jobs?.[0]?.id ?? null;

  const receiveRes = await page.request.post(`/api/inventory/${itemId}/receive`, {
    data: { qty: 5, unit_cost: 6, to_location: "Yard B", notes: "receive stock" },
  });
  expect(receiveRes.status()).toBe(200);

  const issueRes = await page.request.post(`/api/inventory/${itemId}/issue`, {
    data: { qty: 3, job_id: jobId, notes: "issue to job" },
  });
  expect(issueRes.status()).toBe(200);

  const adjustRes = await page.request.post(`/api/inventory/${itemId}/adjust`, {
    data: { qty: 20, unit_cost: 7, notes: "cycle count" },
  });
  expect(adjustRes.status()).toBe(200);

  const transferRes = await page.request.post(`/api/inventory/${itemId}/transfer`, {
    data: { qty: 4, from_location: "Yard B", to_location: "Yard C", notes: "transfer" },
  });
  expect(transferRes.status()).toBe(200);

  const listRes = await page.request.get("/api/inventory");
  expect(listRes.status()).toBe(200);
  const listJson = await listRes.json();
  const rows = (listJson?.items || listJson?.inventory || []) as Array<{ id: string | number; qtyOnHand: number; location?: string }>;
  const savedItem = rows.find((row) => String(row.id) === itemId);
  expect(savedItem).toBeTruthy();
  expect(Number(savedItem?.qtyOnHand)).toBe(20);
  expect(String(savedItem?.location || "")).toContain("Yard C");

  const ledgerRes = await page.request.get(`/api/inventory/${itemId}/ledger?limit=20`);
  expect(ledgerRes.status()).toBe(200);
  const ledgerJson = await ledgerRes.json();
  const ledgerItems = (ledgerJson?.items || []) as Array<{ type: string }>;
  expect(Array.isArray(ledgerItems)).toBe(true);
  expect(ledgerItems.length).toBeGreaterThanOrEqual(4);
  const types = ledgerItems.map((entry) => entry.type);
  expect(types).toContain("receive");
  expect(types).toContain("issue");
  expect(types).toContain("adjust");
  expect(types).toContain("transfer");

  await page.goto("/");
  await page.getByTestId("nav-inventory").click();
  await expect(page.getByText(itemName)).toBeVisible();
  await page.reload();
  await expect(page.getByText(itemName)).toBeVisible();
});
