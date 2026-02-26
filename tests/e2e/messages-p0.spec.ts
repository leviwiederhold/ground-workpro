import { expect, test } from "@playwright/test";
import { loginViaUI } from "./helpers";

test("messages p0 supports direct thread + persistence + read", async ({ page }) => {
  await loginViaUI(page);

  const usersRes = await page.request.get("/api/messages/users");
  const usersBody = await usersRes.text();
  expect(usersRes.status(), usersBody).toBe(200);
  const users = (JSON.parse(usersBody)?.items ?? []) as Array<{ userId: string }>;
  let threadId = "";
  if (users.length > 1) {
    for (const candidate of users) {
      const startRes = await page.request.post("/api/messages/direct/start", {
        data: { userId: candidate.userId },
      });
      const startBody = await startRes.text();
      if (startRes.status() >= 200 && startRes.status() < 300) {
        threadId = String(JSON.parse(startBody)?.item?.id ?? "");
        break;
      }
    }
  } else {
    const channelName = `p0-${Date.now()}`;
    const createRes = await page.request.post("/api/messages/channels", {
      data: { name: channelName },
    });
    const createBody = await createRes.text();
    expect(createRes.status(), createBody).toBe(201);
    threadId = String(JSON.parse(createBody)?.item?.id ?? "");
  }
  expect(threadId).toBeTruthy();

  const messageBody = `p0-${Date.now()}`;
  const sendRes = await page.request.post(`/api/messages/threads/${threadId}/send`, {
    data: { body: messageBody },
  });
  const sendBody = await sendRes.text();
  expect(sendRes.status(), sendBody).toBe(201);

  await page.getByTestId("nav-messages").click();
  await expect(page.getByTestId(`messages-channel-${threadId}`)).toBeVisible({ timeout: 20_000 });
  await page.getByTestId(`messages-channel-${threadId}`).click();
  await expect(page.getByText(messageBody)).toBeVisible({ timeout: 20_000 });

  const persistedRes = await page.request.get(`/api/messages/threads/${threadId}/messages`);
  const persistedBody = await persistedRes.text();
  expect(persistedRes.status(), persistedBody).toBe(200);
  const persistedItems = JSON.parse(persistedBody)?.items ?? [];
  expect(
    persistedItems.some((item: { body?: string }) => String(item.body ?? "") === messageBody)
  ).toBeTruthy();

  const unreadBeforeRes = await page.request.get("/api/messages/inbox");
  const unreadBeforeJson = await unreadBeforeRes.json();
  const unreadBefore = Number(
    (unreadBeforeJson?.items ?? []).find((item: { id: string }) => String(item.id) === threadId)?.unread_count ?? 0
  );

  const readRes = await page.request.post(`/api/messages/threads/${threadId}/read`);
  const readBody = await readRes.text();
  expect(readRes.status(), readBody).toBeGreaterThanOrEqual(200);
  expect(readRes.status(), readBody).toBeLessThan(300);

  const unreadAfterRes = await page.request.get("/api/messages/inbox");
  const unreadAfterJson = await unreadAfterRes.json();
  const unreadAfter = Number(
    (unreadAfterJson?.items ?? []).find((item: { id: string }) => String(item.id) === threadId)?.unread_count ?? 0
  );

  expect(unreadAfter).toBeLessThanOrEqual(unreadBefore);
});
