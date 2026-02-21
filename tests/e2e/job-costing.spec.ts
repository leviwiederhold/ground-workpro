import { expect, test } from "@playwright/test";
import { loginViaUI, seedJobCostingFixture } from "./helpers";

test("job costing summary rollup creates margin drift alert and supports mark read", async ({ page }) => {
  await loginViaUI(page);

  const timestamp = Date.now();
  const { jobId } = await seedJobCostingFixture(page.request, timestamp);

  const summaryResponse = await page.request.get(`/api/jobs/${jobId}/cost-summary`);
  const summaryBody = await summaryResponse.text();
  expect(summaryResponse.status(), summaryBody).toBe(200);
  const summaryJson = JSON.parse(summaryBody);

  expect(summaryJson?.item?.estimatedCost).toBeGreaterThan(0);
  expect(summaryJson?.item?.actualTotalCost).toBeGreaterThan(summaryJson?.item?.estimatedCost);
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
