import { expect, test } from "@playwright/test";
import { loginViaUI } from "./helpers";

test("low inventory alert appears and can be marked read", async ({ page }) => {
  await loginViaUI(page);

  const uniqueName = `Alert Test Item ${Date.now()}`;
  const createInventoryResponse = await page.request.post("/api/inventory", {
    data: {
      name: uniqueName,
      category: "Materials",
      unit: "EA",
      quantity_on_hand: 1,
      reorder_point: 5,
      status: "active",
    },
  });
  expect(createInventoryResponse.status()).toBe(200);
  const createdInventoryPayload = await createInventoryResponse.json();
  const inventoryId = createdInventoryPayload?.item?.id;
  expect(inventoryId).toBeTruthy();

  const listAlertsResponse = await page.request.get("/api/alerts");
  expect(listAlertsResponse.status()).toBe(200);
  const listAlertsPayload = await listAlertsResponse.json();
  const alerts = Array.isArray(listAlertsPayload?.items) ? listAlertsPayload.items : [];
  const lowInventoryAlert = alerts.find(
    (alert: { alert_type?: string; entity_type?: string; entity_id?: string | number }) =>
      alert?.alert_type === "low_inventory" &&
      alert?.entity_type === "inventory" &&
      String(alert?.entity_id) === String(inventoryId)
  );
  expect(lowInventoryAlert?.id).toBeTruthy();
  expect(lowInventoryAlert?.is_read).toBeFalsy();

  const markReadResponse = await page.request.post(
    `/api/alerts/${lowInventoryAlert.id}/read`
  );
  expect(markReadResponse.status()).toBe(200);

  const listAfterReadResponse = await page.request.get("/api/alerts");
  expect(listAfterReadResponse.status()).toBe(200);
  const listAfterReadPayload = await listAfterReadResponse.json();
  const alertsAfterRead = Array.isArray(listAfterReadPayload?.items)
    ? listAfterReadPayload.items
    : [];
  const alertAfterRead = alertsAfterRead.find(
    (alert: { id?: string }) => String(alert?.id) === String(lowInventoryAlert.id)
  );
  expect(alertAfterRead?.is_read).toBeTruthy();

  await page.request.delete(`/api/inventory/${inventoryId}`);
});
