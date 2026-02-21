import { expect, test } from "@playwright/test";
import { loginViaUI } from "./helpers";

type SampleStats = {
  samples: number[];
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  const safeIndex = Math.max(0, Math.min(sorted.length - 1, index));
  return sorted[safeIndex];
}

function summarize(samples: number[]): SampleStats {
  const sorted = [...samples].sort((a, b) => a - b);
  const total = samples.reduce((sum, value) => sum + value, 0);
  return {
    samples,
    avgMs: Number((total / samples.length).toFixed(1)),
    p50Ms: Number(percentile(sorted, 50).toFixed(1)),
    p95Ms: Number(percentile(sorted, 95).toFixed(1)),
  };
}

async function measure(label: string, iterations: number, fn: () => Promise<void>): Promise<SampleStats> {
  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    await fn();
    samples.push(performance.now() - start);
  }

  const stats = summarize(samples);
  // Print baseline in logs so we can paste exact numbers into docs.
  console.log(`[perf] ${label} avg=${stats.avgMs}ms p50=${stats.p50Ms}ms p95=${stats.p95Ms}ms`);
  return stats;
}

test("perf smoke: key pages/apis at realistic data volume", async ({ page }) => {
  await loginViaUI(page);

  const seedResponse = await page.request.post("/api/test/seed-large-data", {
    data: { jobs: 120, channels: 25, messagesPerChannel: 20 },
  });
  expect(seedResponse.ok()).toBeTruthy();

  const pageHome = await measure("page:/", 5, async () => {
    const response = await page.goto("/");
    expect(response?.ok()).toBeTruthy();
    await page.waitForLoadState("networkidle");
  });

  const pageLogin = await measure("page:/login", 5, async () => {
    const response = await page.goto("/login");
    expect(response?.ok()).toBeTruthy();
    await page.waitForLoadState("networkidle");
  });

  const apiJobs = await measure("api:/api/jobs?limit=50", 8, async () => {
    const response = await page.request.get("/api/jobs?limit=50");
    expect(response.ok()).toBeTruthy();
  });

  const apiBids = await measure("api:/api/bids?limit=50", 8, async () => {
    const response = await page.request.get("/api/bids?limit=50");
    expect(response.ok()).toBeTruthy();
  });

  const apiCostCodes = await measure("api:/api/cost-codes?limit=50", 8, async () => {
    const response = await page.request.get("/api/cost-codes?limit=50");
    expect(response.ok()).toBeTruthy();
  });

  expect(pageHome.p95Ms).toBeLessThan(6000);
  expect(pageLogin.p95Ms).toBeLessThan(4000);
  expect(apiJobs.p95Ms).toBeLessThan(1200);
  expect(apiBids.p95Ms).toBeLessThan(1200);
  expect(apiCostCodes.p95Ms).toBeLessThan(1200);
});
