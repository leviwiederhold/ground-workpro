import { expect, test } from "@playwright/test";
import { loginViaUI } from "./helpers";

test("documents upload/list/download/delete works with attachments backend", async ({ page }) => {
  await loginViaUI(page);
  const subscriptionRes = await page.request.post("/api/test/set-subscription", {
    data: { subscription_status: "active" },
  });
  expect(subscriptionRes.status()).toBe(200);

  const fileName = `e2e-doc-${Date.now()}.txt`;
  const content = `documents e2e ${Date.now()}`;

  const uploadResponse = await page.request.post("/api/attachments/upload", {
    timeout: 45_000,
    multipart: {
      entity_type: "document",
      file: {
        name: fileName,
        mimeType: "text/plain",
        buffer: Buffer.from(content, "utf8"),
      },
    },
  });
  const uploadBody = await uploadResponse.text();
  expect(uploadResponse.status(), uploadBody).toBe(200);

  const listResponse = await page.request.get("/api/attachments?entity_type=document");
  expect(listResponse.status()).toBe(200);
  const listJson = await listResponse.json();
  const uploaded = (listJson?.attachments || []).find(
    (item: { fileName?: string }) => item?.fileName === fileName
  );
  expect(uploaded?.id).toBeTruthy();
  expect(uploaded?.download_url || uploaded?.signedDownloadUrl).toBeTruthy();

  const deleteResponse = await page.request.delete(`/api/attachments/${uploaded.id}`);
  expect(deleteResponse.status()).toBe(200);

  const listAfterDeleteResponse = await page.request.get("/api/attachments?entity_type=document");
  expect(listAfterDeleteResponse.status()).toBe(200);
  const listAfterDeleteJson = await listAfterDeleteResponse.json();
  const stillThere = (listAfterDeleteJson?.attachments || []).find(
    (item: { id?: string }) => String(item?.id) === String(uploaded.id)
  );
  expect(stillThere).toBeFalsy();
});
