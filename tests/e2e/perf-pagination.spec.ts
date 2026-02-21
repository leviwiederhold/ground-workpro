import { expect, test } from "@playwright/test";
import { loginViaUI } from "./helpers";

test("large dataset endpoints return deterministic pagination metadata and slices", async ({ page }) => {
  await loginViaUI(page);

  const seedResponse = await page.request.post("/api/test/seed-large-data", {
    data: { jobs: 120, channels: 20, messagesPerChannel: 5 },
  });
  const seedBody = await seedResponse.text();
  expect(seedResponse.status(), seedBody).toBe(200);
  const seedJson = JSON.parse(seedBody);
  expect(seedJson?.item?.inserted_jobs).toBeGreaterThanOrEqual(120);
  if (seedJson?.item?.messages_tables_available) {
    expect(seedJson?.item?.inserted_channels).toBeGreaterThanOrEqual(20);
  }

  const jobsPage1Response = await page.request.get("/api/jobs?page=1&pageSize=25");
  const jobsPage1Body = await jobsPage1Response.text();
  expect(jobsPage1Response.status(), jobsPage1Body).toBe(200);
  const jobsPage1 = JSON.parse(jobsPage1Body);
  expect(Array.isArray(jobsPage1?.jobs)).toBeTruthy();
  expect(jobsPage1.jobs.length).toBe(25);
  expect(jobsPage1.page).toBe(1);
  expect(jobsPage1.pageSize).toBe(25);
  expect(jobsPage1.total).toBeGreaterThanOrEqual(120);

  const jobsPage2Response = await page.request.get("/api/jobs?page=2&pageSize=25");
  const jobsPage2Body = await jobsPage2Response.text();
  expect(jobsPage2Response.status(), jobsPage2Body).toBe(200);
  const jobsPage2 = JSON.parse(jobsPage2Body);
  expect(Array.isArray(jobsPage2?.jobs)).toBeTruthy();
  expect(jobsPage2.jobs.length).toBe(25);
  expect(jobsPage2.page).toBe(2);

  const ids1 = new Set((jobsPage1.jobs || []).map((row: { id: string }) => String(row.id)));
  const ids2 = new Set((jobsPage2.jobs || []).map((row: { id: string }) => String(row.id)));
  let overlap = 0;
  for (const id of ids1) {
    if (ids2.has(id)) overlap += 1;
  }
  expect(overlap).toBe(0);

  if (seedJson?.item?.messages_tables_available) {
    const channelsResponse = await page.request.get("/api/messages/channels?page=1&pageSize=10");
    const channelsBody = await channelsResponse.text();
    expect(channelsResponse.status(), channelsBody).toBe(200);
    const channelsJson = JSON.parse(channelsBody);
    expect(Array.isArray(channelsJson?.items)).toBeTruthy();
    expect(channelsJson.items.length).toBeLessThanOrEqual(10);
    expect(channelsJson.page).toBe(1);
    expect(channelsJson.pageSize).toBe(10);
    expect(channelsJson.total).toBeGreaterThanOrEqual(20);

    const firstChannelId = channelsJson.items[0]?.id;
    expect(firstChannelId).toBeTruthy();

    const messagesResponse = await page.request.get(
      `/api/messages/channels/${firstChannelId}/messages?page=1&pageSize=3`
    );
    const messagesBody = await messagesResponse.text();
    expect(messagesResponse.status(), messagesBody).toBe(200);
    const messagesJson = JSON.parse(messagesBody);
    expect(Array.isArray(messagesJson?.items)).toBeTruthy();
    expect(messagesJson.items.length).toBeLessThanOrEqual(3);
    expect(messagesJson.page).toBe(1);
    expect(messagesJson.pageSize).toBe(3);
  }
});
