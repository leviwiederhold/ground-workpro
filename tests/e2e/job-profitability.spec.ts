import { expect, test } from "@playwright/test";
import { loginViaUI, seedJobCostingFixture } from "./helpers";

test("job profitability endpoint is deterministic and survives reload", async ({ page }) => {
  await loginViaUI(page);

  const timestamp = Date.now();
  const { jobId, bidId } = await seedJobCostingFixture(page.request, timestamp);

  const acceptBidResponse = await page.request.patch(`/api/bids/${bidId}`, {
    data: { status: "accepted" },
  });
  const acceptBidBody = await acceptBidResponse.text();
  expect(acceptBidResponse.status(), acceptBidBody).toBe(200);

  const bidSummaryResponse = await page.request.get(`/api/bids/${bidId}/summary`);
  const bidSummaryBody = await bidSummaryResponse.text();
  expect(bidSummaryResponse.status(), bidSummaryBody).toBe(200);
  const bidSummaryJson = JSON.parse(bidSummaryBody);
  const expectedRevenue = Number(bidSummaryJson?.summary?.revenue ?? 0);

  const firstProfitabilityResponse = await page.request.get(`/api/jobs/${jobId}/profitability`);
  const firstProfitabilityBody = await firstProfitabilityResponse.text();
  expect(firstProfitabilityResponse.status(), firstProfitabilityBody).toBe(200);
  const firstProfitabilityJson = JSON.parse(firstProfitabilityBody);

  expect(firstProfitabilityJson?.item?.job_id).toBe(jobId);
  expect(firstProfitabilityJson?.item?.revenue_source).toBe("accepted_bid");
  expect(firstProfitabilityJson?.item?.accepted_bid_id).toBe(bidId);
  expect(firstProfitabilityJson?.item?.cost_to_date).toBe(225);
  expect(firstProfitabilityJson?.item?.revenue_to_date).toBe(expectedRevenue);
  expect(firstProfitabilityJson?.item?.profit).toBe(Number((expectedRevenue - 225).toFixed(2)));

  await page.reload();

  const secondProfitabilityResponse = await page.request.get(`/api/jobs/${jobId}/profitability`);
  const secondProfitabilityBody = await secondProfitabilityResponse.text();
  expect(secondProfitabilityResponse.status(), secondProfitabilityBody).toBe(200);
  const secondProfitabilityJson = JSON.parse(secondProfitabilityBody);

  expect(secondProfitabilityJson?.item).toEqual(firstProfitabilityJson?.item);
});
