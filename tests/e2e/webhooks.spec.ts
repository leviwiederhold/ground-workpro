import { expect, test } from "@playwright/test";

test("webhook ingestion persists event and honors idempotency key", async ({ request }) => {
  const idempotencyKey = `e2e-webhook-${Date.now()}`;
  const payload = {
    eventId: `evt-${Date.now()}`,
    eventType: "invoice.updated",
    payload: { invoiceId: "inv_123" },
  };

  const firstResponse = await request.post("/api/webhooks/quickbooks", {
    headers: {
      "content-type": "application/json",
      "x-idempotency-key": idempotencyKey,
    },
    data: payload,
    timeout: 30_000,
  });
  const firstBody = await firstResponse.text();
  expect(firstResponse.status(), firstBody).toBe(200);
  const firstJson = JSON.parse(firstBody);
  expect(firstJson?.item?.id).toBeTruthy();
  expect(firstJson?.item?.provider).toBe("quickbooks");
  expect(firstJson?.item?.duplicate).toBe(false);
  expect(firstJson?.item?.status).toBe("received_unverified");

  const secondResponse = await request.post("/api/webhooks/quickbooks", {
    headers: {
      "content-type": "application/json",
      "x-idempotency-key": idempotencyKey,
    },
    data: payload,
    timeout: 30_000,
  });
  const secondBody = await secondResponse.text();
  expect(secondResponse.status(), secondBody).toBe(200);
  const secondJson = JSON.parse(secondBody);
  expect(secondJson?.item?.id).toBe(firstJson?.item?.id);
  expect(secondJson?.item?.duplicate).toBe(true);
});
