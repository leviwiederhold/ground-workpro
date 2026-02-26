import { expect, test } from "@playwright/test";
import { loginViaUI } from "./helpers";

test("vendors command center persists profile, status, po link, and docs", async ({ page }) => {
  await loginViaUI(page);

  const stamp = Date.now();
  const vendorName = `Vendor Command ${stamp}`;
  const vendorEmail = `vendor-${stamp}@example.com`;

  const createVendorRes = await page.request.post("/api/vendors", {
    data: {
      name: vendorName,
      status: "active",
      category: "Aggregates",
      contact_name: "Vendor Contact",
      phone: "555-0100",
      email: vendorEmail,
      address: "123 Test Ave",
      payment_terms: "Net 30",
      notes: "Vendor command center smoke",
    },
  });
  expect(createVendorRes.status()).toBe(200);
  const createVendorJson = await createVendorRes.json();
  const vendor = createVendorJson?.item ?? createVendorJson?.vendor;
  expect(vendor?.id).toBeTruthy();

  const vendorId = String(vendor.id);

  const patchVendorRes = await page.request.patch(`/api/vendors/${vendorId}`, {
    data: { status: "preferred" },
  });
  expect(patchVendorRes.status()).toBe(200);

  const createPoRes = await page.request.post("/api/purchase-orders", {
    data: {
      vendor_id: vendorId,
      status: "draft",
      notes: "Vendor command center PO",
    },
  });
  expect(createPoRes.status()).toBe(200);
  const createPoJson = await createPoRes.json();
  expect(createPoJson?.purchase_order?.id).toBeTruthy();

  const uploadDocRes = await page.request.post("/api/attachments/upload", {
    multipart: {
      entity_type: "vendor",
      entity_id: vendorId,
      file: {
        name: `vendor-doc-${stamp}.txt`,
        mimeType: "text/plain",
        buffer: Buffer.from(`vendor-doc-${stamp}`),
      },
    },
  });
  expect(uploadDocRes.status()).toBe(200);

  const summaryRes = await page.request.get(`/api/vendors/${vendorId}/summary`);
  expect(summaryRes.status()).toBe(200);
  const summaryJson = await summaryRes.json();
  expect(summaryJson?.item?.profile?.name).toBe(vendorName);
  expect(summaryJson?.item?.profile?.status).toBe("preferred");
  expect(Number(summaryJson?.item?.metrics?.open_po_count || 0)).toBeGreaterThan(0);
  expect((summaryJson?.item?.documents || []).length).toBeGreaterThan(0);

  await page.goto("/");
  await page.getByTestId("nav-vendors").click();
  await expect(page.getByText(vendorName)).toBeVisible();
  await page.reload();
  await expect(page.getByText(vendorName)).toBeVisible();
});
