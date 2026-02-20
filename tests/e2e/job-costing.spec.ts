import { expect, test } from "@playwright/test";
import { loginViaUI } from "./helpers";

test("job costing summary rollup creates margin drift alert and supports mark read", async ({ page }) => {
  await loginViaUI(page);

  const timestamp = Date.now();
  const jobName = `Costing Job ${timestamp}`;
  const vendorName = `Costing Vendor ${timestamp}`;
  const equipmentName = `Costing Equipment ${timestamp}`;

  const createJobResponse = await page.request.post("/api/jobs", {
    data: { name: jobName, status: "draft" },
  });
  expect(createJobResponse.status()).toBe(200);
  const createJobJson = await createJobResponse.json();
  const jobId = createJobJson?.job?.id;
  expect(jobId).toBeTruthy();

  const createBidResponse = await page.request.post("/api/bids", {
    data: { title: `Bid ${timestamp}`, status: "draft", job_id: jobId },
  });
  expect(createBidResponse.status()).toBe(200);
  const createBidJson = await createBidResponse.json();
  const bidId = createBidJson?.bid?.id;
  expect(bidId).toBeTruthy();

  const createBidItemResponse = await page.request.post(`/api/bids/${bidId}/items`, {
    data: { item_type: "custom", description: "Estimate baseline", quantity: 1, unit_cost: 100 },
  });
  expect(createBidItemResponse.status()).toBe(200);

  const createEquipmentResponse = await page.request.post("/api/equipment", {
    data: { name: equipmentName, type: "Equipment", status: "active", dailyRate: 960 },
  });
  expect(createEquipmentResponse.status()).toBe(200);
  const createEquipmentJson = await createEquipmentResponse.json();
  const equipmentId = createEquipmentJson?.equipment?.id;
  expect(equipmentId).toBeTruthy();

  const createReportResponse = await page.request.post("/api/daily-reports", {
    data: {
      jobId,
      date: new Date().toISOString().slice(0, 10),
      weather: "Clear",
      tempHigh: 65,
      tempLow: 48,
      crewSize: 1,
      workAccomplished: "Costing test",
      notes: "Costing test",
    },
  });
  expect(createReportResponse.status()).toBe(200);
  const createReportJson = await createReportResponse.json();
  const reportId = createReportJson?.dailyReport?.id;
  expect(reportId).toBeTruthy();

  const createEntryResponse = await page.request.post(`/api/daily-reports/${reportId}/entries`, {
    data: { entry_type: "equipment", equipment_id: equipmentId, hours: 1 },
  });
  expect(createEntryResponse.status()).toBe(200);

  const createVendorResponse = await page.request.post("/api/vendors", {
    data: { name: vendorName, status: "active" },
  });
  expect(createVendorResponse.status()).toBe(200);
  const createVendorJson = await createVendorResponse.json();
  const vendorId = createVendorJson?.vendor?.id;
  expect(vendorId).toBeTruthy();

  const createPoResponse = await page.request.post("/api/purchase-orders", {
    data: { vendor_id: vendorId, job_id: jobId, status: "draft", notes: "Costing PO" },
  });
  expect(createPoResponse.status()).toBe(200);
  const createPoJson = await createPoResponse.json();
  const poId = createPoJson?.purchase_order?.id;
  expect(poId).toBeTruthy();

  const createPoItemResponse = await page.request.post(`/api/purchase-orders/${poId}/items`, {
    data: { description: "PO cost", quantity: 1, unit_cost: 25 },
  });
  expect(createPoItemResponse.status()).toBe(200);

  const summaryResponse = await page.request.get(`/api/jobs/${jobId}/cost-summary`);
  const summaryBody = await summaryResponse.text();
  expect(summaryResponse.status(), summaryBody).toBe(200);
  const summaryJson = JSON.parse(summaryBody);
  expect(summaryJson?.item?.estimatedCost).toBeGreaterThan(0);
  expect(summaryJson?.item?.actualCost).toBeGreaterThan(summaryJson?.item?.estimatedCost);
  expect(summaryJson?.item?.isOverBudget).toBeTruthy();

  const alertsResponse = await page.request.get("/api/alerts");
  expect(alertsResponse.status()).toBe(200);
  const alertsJson = await alertsResponse.json();
  const driftAlert = (alertsJson?.items || []).find(
    (item: { alert_type?: string; entity_type?: string; entity_id?: string | number }) =>
      item?.alert_type === "margin_drift" &&
      item?.entity_type === "job" &&
      String(item?.entity_id) === String(jobId)
  );
  expect(driftAlert?.id).toBeTruthy();

  const markReadResponse = await page.request.post(`/api/alerts/${driftAlert.id}/read`);
  expect(markReadResponse.status()).toBe(200);

  const alertsAfterReadResponse = await page.request.get("/api/alerts");
  expect(alertsAfterReadResponse.status()).toBe(200);
  const alertsAfterReadJson = await alertsAfterReadResponse.json();
  const driftAlertAfterRead = (alertsAfterReadJson?.items || []).find(
    (item: { id?: string }) => String(item?.id) === String(driftAlert.id)
  );
  expect(driftAlertAfterRead?.is_read).toBeTruthy();
});
