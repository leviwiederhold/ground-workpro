import { expect, test, type Page } from "@playwright/test";
import { loginViaUI } from "./helpers";

const THREAD_ID = "11111111-1111-4111-8111-111111111111";

function message(index: number, body = `Historical message ${index}`) {
  return {
    id: `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`,
    thread_id: THREAD_ID,
    channel_id: THREAD_ID,
    sender_user_id: index % 2 === 0 ? "33333333-3333-4333-8333-333333333333" : "44444444-4444-4444-8444-444444444444",
    sender_display_name: index % 2 === 0 ? "Alex Foreman" : "You",
    sender_avatar_url: "",
    body,
    created_at: new Date(Date.UTC(2026, 7, 11, 12, index)).toISOString(),
    edited_at: null,
    attachments: [],
  };
}

async function mockMessageLayoutApis(page: Page) {
  const messages = Array.from({ length: 55 }, (_, index) => message(index + 1));

  await page.route("**/api/company-members**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [{
          userId: "33333333-3333-4333-8333-333333333333",
          displayName: "Alex Foreman",
          role: "foreman",
        }],
      }),
    });
  });
  await page.route("**/api/messages/inbox", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        viewer_is_admin: true,
        company_name: "Groundwork Test",
        items: [{
          id: THREAD_ID,
          kind: "group",
          name: "Field Updates",
          is_companywide: true,
          member_count: 2,
          message_count: messages.length,
          unread_count: 0,
          last_message_at: messages.at(-1)?.created_at,
          last_message_preview: messages.at(-1)?.body,
        }],
      }),
    });
  });
  await page.route(`**/api/messages/threads/${THREAD_ID}/messages?*`, async (route) => {
    const url = new URL(route.request().url());
    const pageNumber = Number(url.searchParams.get("page") || 1);
    const pageSize = Number(url.searchParams.get("pageSize") || 50);
    const descending = [...messages].reverse();
    const pageItems = descending
      .slice((pageNumber - 1) * pageSize, pageNumber * pageSize)
      .reverse();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: pageItems,
        total: messages.length,
        page: pageNumber,
        pageSize,
        totalPages: Math.ceil(messages.length / pageSize),
      }),
    });
  });
  await page.route(`**/api/messages/threads/${THREAD_ID}/read`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.route(`**/api/messages/threads/${THREAD_ID}/send`, async (route) => {
    const payload = route.request().postDataJSON() as { body?: string };
    const item = message(messages.length + 1, String(payload.body || ""));
    messages.push(item);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ item }),
    });
  });

  return {
    addIncoming(body: string) {
      const item = message(messages.length + 1, body);
      messages.push(item);
      return item;
    },
  };
}

test("messages conversation list fills the available sidebar height before scrolling", async ({ page }) => {
  await mockMessageLayoutApis(page);
  await loginViaUI(page);

  await page.goto("/");
  await page.getByTestId("nav-messages").click();
  const list = page.getByTestId("messages-sidebar");
  await expect(list).toBeVisible();

  const clientHeight = await list.evaluate((node) => node.clientHeight);
  expect(clientHeight).toBeGreaterThan(500);
});

test("messages mobile uses full-screen list-to-thread, newest scroll, history anchoring, and live jump behavior", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = await mockMessageLayoutApis(page);
  await loginViaUI(page);

  await page.goto("/");
  await page.getByLabel("Open sidebar").click();
  await page.getByTestId("nav-messages").click();

  const root = page.getByTestId("messages-root");
  await expect(root).toBeVisible();
  await expect(page.getByTestId("messages-sidebar")).toBeVisible();

  const initialMetrics = await page.evaluate(() => {
    const rootNode = document.querySelector('[data-testid="messages-root"]');
    if (!rootNode) throw new Error("Messages root is missing");
    const rect = rootNode.getBoundingClientRect();
    return {
      rootHeight: Math.round(rect.height),
      viewportHeight: Math.round(window.visualViewport?.height ?? window.innerHeight),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });
  expect(initialMetrics.rootHeight).toBeLessThanOrEqual(initialMetrics.viewportHeight);
  expect(initialMetrics.horizontalOverflow).toBeFalsy();

  await page.getByTestId(`messages-channel-${THREAD_ID}`).click();
  await expect(page.getByTestId("messages-sidebar")).toBeHidden();
  await expect(page.getByTestId("messages-thread")).toBeVisible();
  await expect(page.getByTestId("messages-input")).toHaveAttribute("placeholder", "Send message");
  await expect(page.getByTestId("messages-message-22222222-2222-4222-8222-000000000055")).toBeVisible();

  const scrollRegion = page.getByTestId("messages-scroll-region");
  await expect.poll(async () => scrollRegion.evaluate((node) => (
    node.scrollHeight - node.clientHeight - node.scrollTop
  ))).toBeLessThanOrEqual(2);

  await scrollRegion.evaluate((node) => { node.scrollTop = 0; });
  const historyBefore = await scrollRegion.evaluate((node) => ({
    top: node.scrollTop,
    height: node.scrollHeight,
  }));
  await page.getByTestId("messages-load-older").click();
  await expect(page.getByTestId("messages-message-22222222-2222-4222-8222-000000000001")).toBeVisible();
  const historyAfter = await scrollRegion.evaluate((node) => ({
    top: node.scrollTop,
    height: node.scrollHeight,
  }));
  expect(Math.abs(
    historyAfter.top - historyBefore.top - (historyAfter.height - historyBefore.height)
  )).toBeLessThanOrEqual(2);

  await scrollRegion.evaluate((node) => { node.scrollTop = 0; });
  fixture.addIncoming("Incoming while reading history");
  await page.evaluate((threadId) => {
    window.dispatchEvent(new CustomEvent("groundwork:message-push-received", { detail: { threadId } }));
  }, THREAD_ID);
  await expect(page.getByTestId("messages-jump-to-bottom")).toBeVisible();
  await page.getByTestId("messages-jump-to-bottom").click();
  await expect(page.getByTestId("messages-jump-to-bottom")).toBeHidden();

  await page.getByTestId("messages-input").fill("Send keeps latest visible");
  await page.getByTestId("messages-send").click();
  await expect(page.getByText("Send keeps latest visible", { exact: true })).toBeVisible();
  await expect.poll(async () => scrollRegion.evaluate((node) => (
    node.scrollHeight - node.clientHeight - node.scrollTop
  ))).toBeLessThanOrEqual(2);

  const fixedLayout = await page.evaluate(() => {
    const rootNode = document.querySelector('[data-testid="messages-root"]')?.getBoundingClientRect();
    const header = document.querySelector('[data-testid="messages-thread-header"]')?.getBoundingClientRect();
    const composer = document.querySelector('[data-testid="messages-composer"]')?.getBoundingClientRect();
    if (!rootNode || !header || !composer) throw new Error("Mobile message layout is incomplete");
    return {
      headerInside: header.top >= rootNode.top - 1,
      composerInside: composer.bottom <= rootNode.bottom + 1,
      messageSpace: composer.top - header.bottom,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });
  expect(fixedLayout.headerInside).toBeTruthy();
  expect(fixedLayout.composerInside).toBeTruthy();
  expect(fixedLayout.messageSpace).toBeGreaterThan(200);
  expect(fixedLayout.horizontalOverflow).toBeFalsy();

  await page.getByTestId("messages-input").focus();
  await expect(page.getByTestId("messages-composer")).toBeInViewport();
  await page.getByTestId("messages-back").click();
  await expect(page.getByTestId("messages-sidebar")).toBeVisible();
  await expect(page.getByTestId("messages-thread")).toBeHidden();
});
