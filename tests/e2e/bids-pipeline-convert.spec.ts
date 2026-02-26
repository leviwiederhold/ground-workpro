import { expect, test } from "@playwright/test";
import { loginViaUI } from "./helpers";

test("bids pipeline stage flow and convert-to-job", async ({ page }) => {
  await loginViaUI(page);

  const stamp = Date.now();
  const createBid = await page.request.post("/api/bids", {
    data: {
      title: `Pipeline Bid ${stamp}`,
      stage: "estimating",
      probability: 65,
    },
  });
  const createBody = await createBid.text();
  expect(createBid.status(), createBody).toBe(200);
  const bidId = String(JSON.parse(createBody)?.bid?.id ?? "");
  expect(bidId).toBeTruthy();

  const reviewReady = await page.request.patch(`/api/bids/${bidId}`, {
    data: { stage: "review", review_ready: true },
  });
  const reviewReadyBody = await reviewReady.text();
  expect(reviewReady.status(), reviewReadyBody).toBe(200);

  const reviewApproved = await page.request.patch(`/api/bids/${bidId}`, {
    data: { review_approved: true },
  });
  const reviewApprovedBody = await reviewApproved.text();
  expect(reviewApproved.status(), reviewApprovedBody).toBe(200);

  const converted = await page.request.post(`/api/bids/${bidId}/convert`, {
    data: {},
  });
  const convertedBody = await converted.text();
  expect(converted.status(), convertedBody).toBe(200);
  const jobId = String(JSON.parse(convertedBody)?.item?.job_id ?? "");
  expect(jobId).toBeTruthy();

  const jobsRes = await page.request.get("/api/jobs");
  const jobsBody = await jobsRes.text();
  expect(jobsRes.status(), jobsBody).toBe(200);
  const jobs = JSON.parse(jobsBody)?.items ?? JSON.parse(jobsBody)?.jobs ?? [];
  expect(jobs.some((job: { id: string }) => String(job.id) === jobId)).toBeTruthy();

  const bidsRes = await page.request.get("/api/bids");
  const bidsBody = await bidsRes.text();
  expect(bidsRes.status(), bidsBody).toBe(200);
  const bidsPayload = JSON.parse(bidsBody);
  const persistedBid = (bidsPayload?.bids ?? []).find((bid: { id: string }) => String(bid.id) === bidId);
  expect(Boolean(persistedBid)).toBeTruthy();
});
