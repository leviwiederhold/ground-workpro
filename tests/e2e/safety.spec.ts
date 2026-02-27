import { expect, test } from "@playwright/test";
import { loginViaUI } from "./helpers";

test("safety logs create/delete persists across refresh", async ({ page }) => {
  await loginViaUI(page);

  await page.goto("/");
  await page.getByTestId("nav-safety").click();
  await expect(page.getByTestId("safety-open-create")).toBeVisible();

  const uniqueNote = `E2E safety ${Date.now()}`;

  await page.getByTestId("safety-open-create").click();
  await page.getByTestId("safety-topic").selectOption({ index: 1 });
  await page.getByTestId("safety-notes").fill(uniqueNote);

  const createResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/safety-logs") && response.request().method() === "POST"
  );
  await page.getByTestId("safety-submit").click();
  const createResponse = await createResponsePromise;
  const createBodyText = await createResponse.text();
  expect(createResponse.status(), createBodyText).toBe(201);
  await page.reload();
  await page.getByTestId("nav-safety").click();
  const createdRow = page
    .locator('[data-testid^="safety-log-row-"]')
    .filter({ hasText: uniqueNote })
    .first();
  await expect(createdRow).toBeVisible({ timeout: 20_000 });
  await expect(createdRow.getByText(uniqueNote)).toBeVisible();

  const deleteResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/safety-logs/") &&
      response.request().method() === "DELETE"
  );
  page.once("dialog", (dialog) => dialog.accept());
  await createdRow.locator('[data-testid^="safety-delete-"]').first().click();
  const deleteResponse = await deleteResponsePromise;
  const deleteBodyText = await deleteResponse.text();
  expect(deleteResponse.status(), deleteBodyText).toBe(200);

  await page.reload();
  await page.getByTestId("nav-safety").click();
  await expect(
    page
      .locator('[data-testid^="safety-log-row-"]')
      .filter({ hasText: uniqueNote })
  ).toHaveCount(0, { timeout: 20_000 });
});
