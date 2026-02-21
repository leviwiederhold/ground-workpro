import { expect, test } from "@playwright/test";
import { loginViaUI } from "./helpers";

test("integrations quickbooks connection persists across reload", async ({ page }) => {
  await loginViaUI(page);

  await page.goto("/");
  await page.getByTestId("nav-integrations").click();
  await expect(page.getByTestId("integration-card-quickbooks")).toBeVisible();

  // Normalize starting state so the test is deterministic.
  const disconnectNormalize = await page.request.post("/api/integrations/quickbooks/disconnect");
  expect(disconnectNormalize.status()).toBe(200);

  await page.reload();
  await page.getByTestId("nav-integrations").click();
  const connectButton = page.getByTestId("integration-connect-quickbooks");
  await expect(connectButton).toBeVisible();
  const connectResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/integrations/quickbooks/connect") &&
      response.request().method() === "POST"
  );
  await connectButton.click();
  const connectResponse = await connectResponsePromise;
  const connectBody = await connectResponse.text();
  expect(connectResponse.status(), connectBody).toBe(200);

  await page.reload();
  await page.getByTestId("nav-integrations").click();
  const quickbooksCard = page.getByTestId("integration-card-quickbooks");
  const disconnectButton = page.getByTestId("integration-disconnect-quickbooks");
  await expect(disconnectButton).toBeVisible();
  await expect(quickbooksCard.getByText("Connected")).toBeVisible();

  const disconnectResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/integrations/quickbooks/disconnect") &&
      response.request().method() === "POST"
  );
  await disconnectButton.click();
  const disconnectResponse = await disconnectResponsePromise;
  const disconnectBody = await disconnectResponse.text();
  expect(disconnectResponse.status(), disconnectBody).toBe(200);
  await page.reload();
  await page.getByTestId("nav-integrations").click();
  await expect(page.getByTestId("integration-connect-quickbooks")).toBeVisible();
});
