import { expect, test } from "@playwright/test";
import { loginViaUI } from "./helpers";

test("messages channels and messages persist across reload", async ({ page }) => {
  await loginViaUI(page);

  await page.goto("/");
  await page.getByTestId("nav-messages").click();
  await expect(page.getByTestId("messages-create-channel-open")).toBeVisible();

  const channelName = `e2e-channel-${Date.now()}`;
  const messageBody = `e2e message ${Date.now()}`;

  await page.getByTestId("messages-create-channel-open").click();
  await page.getByTestId("messages-create-channel-input").fill(channelName);

  const createChannelResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/messages/channels") &&
      response.request().method() === "POST"
  );
  await page.getByTestId("messages-create-channel-submit").click();
  const createChannelResponse = await createChannelResponsePromise;
  const createChannelBody = await createChannelResponse.text();
  expect(createChannelResponse.status(), createChannelBody).toBe(201);
  const createdChannel = JSON.parse(createChannelBody)?.item;
  expect(createdChannel?.id).toBeTruthy();

  await expect(page.getByTestId(`messages-channel-${createdChannel.id}`)).toBeVisible();

  await page.getByTestId("messages-input").fill(messageBody);
  const sendResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/messages/channels/${createdChannel.id}/send`) &&
      response.request().method() === "POST"
  );
  await page.getByTestId("messages-send").click();
  const sendResponse = await sendResponsePromise;
  const sendBody = await sendResponse.text();
  expect(sendResponse.status(), sendBody).toBe(201);

  await expect(page.getByText(messageBody)).toBeVisible();

  await page.reload();
  await page.getByTestId("nav-messages").click();
  await expect(page.getByTestId(`messages-channel-${createdChannel.id}`)).toBeVisible({ timeout: 20_000 });
  await page.getByTestId(`messages-channel-${createdChannel.id}`).click();
  await expect(page.getByText(messageBody)).toBeVisible({ timeout: 20_000 });
});
