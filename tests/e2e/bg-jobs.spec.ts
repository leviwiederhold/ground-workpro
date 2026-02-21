import { expect, test } from "@playwright/test";
import { loginViaUI } from "./helpers";

test("bg jobs enqueue, process, retry, and DLQ", async ({ page }) => {
  await loginViaUI(page);

  const marker = `e2e-bg-${Date.now()}`;

  const enqueueSuccess = await page.request.post("/api/bg-jobs", {
    data: {
      type: "stub.sync",
      payload: { marker },
      max_attempts: 3,
    },
  });
  expect(enqueueSuccess.status()).toBe(201);
  const enqueueSuccessBody = await enqueueSuccess.json();
  const successJobId = enqueueSuccessBody?.item?.id as string;
  expect(successJobId).toBeTruthy();

  const runSuccess = await page.request.post("/api/bg-jobs/run", {
    data: { limit: 10 },
  });
  expect(runSuccess.status()).toBe(200);

  const listAfterSuccess = await page.request.get("/api/bg-jobs?limit=100");
  expect(listAfterSuccess.status()).toBe(200);
  const listAfterSuccessJson = await listAfterSuccess.json();
  const successJob = (listAfterSuccessJson?.items ?? []).find((item: { id: string }) => item.id === successJobId);
  expect(successJob?.status).toBe("completed");

  const failingMarker = `e2e-bg-fail-${Date.now()}`;
  const enqueueFail = await page.request.post("/api/bg-jobs", {
    data: {
      type: "stub.sync",
      payload: { marker: failingMarker, shouldFail: true },
      max_attempts: 2,
    },
  });
  expect(enqueueFail.status()).toBe(201);
  const enqueueFailBody = await enqueueFail.json();
  const failingJobId = enqueueFailBody?.item?.id as string;
  expect(failingJobId).toBeTruthy();

  const runFail1 = await page.request.post("/api/bg-jobs/run", {
    data: { limit: 10 },
  });
  expect(runFail1.status()).toBe(200);

  const runFail2 = await page.request.post("/api/bg-jobs/run", {
    data: { limit: 10, force_due: true },
  });
  expect(runFail2.status()).toBe(200);

  const jobsAfterFailure = await page.request.get("/api/bg-jobs?limit=100");
  expect(jobsAfterFailure.status()).toBe(200);
  const jobsAfterFailureJson = await jobsAfterFailure.json();
  const failingJobStillQueued = (jobsAfterFailureJson?.items ?? []).find(
    (item: { id: string }) => item.id === failingJobId
  );
  expect(failingJobStillQueued).toBeFalsy();

  const dlqList = await page.request.get("/api/bg-jobs/dlq?limit=100");
  expect(dlqList.status()).toBe(200);
  const dlqJson = await dlqList.json();
  const dlqEntry = (dlqJson?.items ?? []).find((item: { bg_job_id: string }) => item.bg_job_id === failingJobId);
  expect(dlqEntry).toBeTruthy();
  expect(dlqEntry.attempts).toBe(2);
});
