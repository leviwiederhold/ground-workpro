import { expect, test } from "@playwright/test";
import { loginViaUI } from "./helpers";

test("messages p0 supports direct thread + persistence + read", async ({ page }) => {
  await loginViaUI(page);

  const usersRes = await page.request.get("/api/messages/users", { timeout: 30_000 });
  const usersBody = await usersRes.text();
  expect(usersRes.status(), usersBody).toBe(200);
  const users = (JSON.parse(usersBody)?.items ?? []) as Array<{ userId: string }>;
  if (users.length === 0) {
    test.skip(true, "No teammate account available for direct-message p0 test");
  }

  const startRes = await page.request.post("/api/messages/direct/start", {
    data: { userId: users[0].userId },
    timeout: 15_000,
  });
  const startBody = await startRes.text();
  expect(startRes.status(), startBody).toBeGreaterThanOrEqual(200);
  expect(startRes.status(), startBody).toBeLessThan(300);

  const threadId = String(JSON.parse(startBody)?.item?.id ?? "");
  expect(threadId).toBeTruthy();

  const messageBody = `p0-${Date.now()}`;
  const sendRes = await page.request.post(`/api/messages/threads/${threadId}/send`, {
    data: { body: messageBody },
    timeout: 30_000,
  });
  const sendBody = await sendRes.text();
  expect(sendRes.status(), sendBody).toBe(201);

  const persistedRes = await page.request.get(`/api/messages/threads/${threadId}/messages`, { timeout: 30_000 });
  const persistedBody = await persistedRes.text();
  expect(persistedRes.status(), persistedBody).toBe(200);
  const persistedItems = JSON.parse(persistedBody)?.items ?? [];
  expect(
    persistedItems.some((item: { body?: string }) => String(item.body ?? "") === messageBody)
  ).toBeTruthy();

  const unreadBeforeRes = await page.request.get("/api/messages/inbox", { timeout: 30_000 });
  const unreadBeforeJson = await unreadBeforeRes.json();
  const unreadBefore = Number(
    (unreadBeforeJson?.items ?? []).find((item: { id: string }) => String(item.id) === threadId)?.unread_count ?? 0
  );

  const readRes = await page.request.post(`/api/messages/threads/${threadId}/read`, { timeout: 30_000 });
  const readBody = await readRes.text();
  expect(readRes.status(), readBody).toBeGreaterThanOrEqual(200);
  expect(readRes.status(), readBody).toBeLessThan(300);

  const unreadAfterRes = await page.request.get("/api/messages/inbox", { timeout: 30_000 });
  const unreadAfterJson = await unreadAfterRes.json();
  const unreadAfter = Number(
    (unreadAfterJson?.items ?? []).find((item: { id: string }) => String(item.id) === threadId)?.unread_count ?? 0
  );

  expect(unreadAfter).toBeLessThanOrEqual(unreadBefore);
});
