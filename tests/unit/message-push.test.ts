import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildMessagePushContent,
  classifyApnsResponse,
  enqueueMessagePushSafely,
  selectEligiblePushDevices,
  type PushDeviceCandidate,
} from "../../src/lib/push/domain.ts";
import {
  buildMessageThreadHref,
  getMessageThreadIdFromPushData,
  shouldSuppressForegroundMessagePush,
} from "../../src/lib/push/navigation.ts";
import { didPushTokenRotate } from "../../src/lib/push/registration.ts";
import { isAuthorizedPushDispatchRequest } from "../../src/lib/push/security.ts";

const companyId = "11111111-1111-4111-8111-111111111111";
const senderId = "22222222-2222-4222-8222-222222222222";
const recipientA = "33333333-3333-4333-8333-333333333333";
const recipientB = "44444444-4444-4444-8444-444444444444";
const threadId = "55555555-5555-4555-8555-555555555555";

function device(overrides: Partial<PushDeviceCandidate> = {}): PushDeviceCandidate {
  return {
    id: crypto.randomUUID(),
    company_id: companyId,
    user_id: recipientA,
    platform: "ios",
    device_id: crypto.randomUUID(),
    push_token: "a".repeat(64),
    push_environment: "production",
    enabled: true,
    revoked_at: null,
    ...overrides,
  };
}

test("sender is always excluded from message push recipients", () => {
  const devices = [device({ user_id: senderId }), device({ user_id: recipientA })];
  const selected = selectEligiblePushDevices({
    companyId,
    senderUserId: senderId,
    participantUserIds: [senderId, recipientA],
    activeMemberUserIds: [senderId, recipientA],
    devices,
  });
  assert.deepEqual(selected.map((row) => row.user_id), [recipientA]);
});

test("one recipient receives one eligible device notification", () => {
  const selected = selectEligiblePushDevices({
    companyId,
    senderUserId: senderId,
    participantUserIds: [senderId, recipientA],
    activeMemberUserIds: [senderId, recipientA],
    devices: [device()],
  });
  assert.equal(selected.length, 1);
});

test("multiple recipients each receive their eligible devices", () => {
  const selected = selectEligiblePushDevices({
    companyId,
    senderUserId: senderId,
    participantUserIds: [senderId, recipientA, recipientB],
    activeMemberUserIds: [senderId, recipientA, recipientB],
    devices: [device({ user_id: recipientA }), device({ user_id: recipientB })],
  });
  assert.deepEqual(new Set(selected.map((row) => row.user_id)), new Set([recipientA, recipientB]));
});

test("multiple devices for one recipient are all selected", () => {
  const selected = selectEligiblePushDevices({
    companyId,
    senderUserId: senderId,
    participantUserIds: [senderId, recipientA],
    activeMemberUserIds: [senderId, recipientA],
    devices: [device(), device()],
  });
  assert.equal(selected.length, 2);
  assert.notEqual(selected[0].device_id, selected[1].device_id);
});

test("disabled and revoked tokens are skipped", () => {
  const selected = selectEligiblePushDevices({
    companyId,
    senderUserId: senderId,
    participantUserIds: [senderId, recipientA],
    activeMemberUserIds: [senderId, recipientA],
    devices: [
      device({ enabled: false }),
      device({ revoked_at: new Date().toISOString() }),
      device(),
    ],
  });
  assert.equal(selected.length, 1);
});

test("a participant who left the company is excluded even if a token remains", () => {
  const selected = selectEligiblePushDevices({
    companyId,
    senderUserId: senderId,
    participantUserIds: [senderId, recipientA],
    activeMemberUserIds: [senderId],
    devices: [device({ user_id: recipientA })],
  });
  assert.equal(selected.length, 0);
});

test("token rotation preserves the device identity while changing the provider token", () => {
  const deviceId = crypto.randomUUID();
  assert.equal(
    didPushTokenRotate(
      { platform: "ios", deviceId, token: "a".repeat(64) },
      { platform: "ios", deviceId, token: "b".repeat(64) }
    ),
    true
  );
  const migration = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations/20260808_02_native_message_push.sql"),
    "utf8"
  );
  assert.match(migration, /on conflict \(platform, device_id\) do update/i);
  assert.match(migration, /push_token = excluded\.push_token/i);
});

test("message previews include the sender and truncate whitespace-safe text", () => {
  const content = buildMessagePushContent({
    senderName: "Jaden Smith",
    messageBody: `  ${"x".repeat(150)}\nmore  `,
  });
  assert.equal(content.title, "New message from Jaden Smith");
  assert.equal(content.body.length, 120);
  assert.match(content.body, /…$/);
});

test("stale APNs tokens are revoked while provider failures retry", () => {
  assert.deepEqual(classifyApnsResponse(410, "Unregistered"), {
    invalidToken: true,
    retryable: false,
  });
  assert.deepEqual(classifyApnsResponse(503, "ServiceUnavailable"), {
    invalidToken: false,
    retryable: true,
  });
});

test("notification tap data routes to the exact conversation", () => {
  assert.equal(getMessageThreadIdFromPushData({ threadId }), threadId);
  assert.equal(buildMessageThreadHref(threadId), `/messages?thread=${threadId}`);
  assert.equal(getMessageThreadIdFromPushData({ threadId: "not-a-thread" }), null);
});

test("foreground push is suppressed for the conversation already open", () => {
  assert.equal(
    shouldSuppressForegroundMessagePush({
      pathname: "/messages",
      activeThreadId: threadId,
      incomingThreadId: threadId,
    }),
    true
  );
  assert.equal(
    shouldSuppressForegroundMessagePush({
      pathname: "/messages",
      activeThreadId: crypto.randomUUID(),
      incomingThreadId: threadId,
    }),
    false
  );
});

test("push enqueue failure never fails the saved message path", async () => {
  let logged = false;
  const queued = await enqueueMessagePushSafely(
    async () => {
      throw new Error("provider unavailable");
    },
    () => {
      logged = true;
    }
  );
  assert.equal(queued, false);
  assert.equal(logged, true);
});

test("unauthorized callers cannot run arbitrary push dispatch", () => {
  const secret = "a-strong-server-secret";
  assert.equal(
    isAuthorizedPushDispatchRequest(new Request("https://example.com/api/push/dispatch"), secret),
    false
  );
  assert.equal(
    isAuthorizedPushDispatchRequest(
      new Request("https://example.com/api/push/dispatch", {
        headers: { authorization: "Bearer wrong" },
      }),
      secret
    ),
    false
  );
  assert.equal(
    isAuthorizedPushDispatchRequest(
      new Request("https://example.com/api/push/dispatch", {
        headers: { authorization: `Bearer ${secret}` },
      }),
      secret
    ),
    true
  );
});

test("push tables are server-only and membership removal revokes tokens", () => {
  const migration = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations/20260808_02_native_message_push.sql"),
    "utf8"
  );
  assert.match(migration, /alter table public\.push_devices enable row level security/i);
  assert.match(migration, /revoke all on public\.push_devices from anon, authenticated/i);
  assert.match(migration, /after delete on public\.memberships/i);
  assert.match(migration, /revoked_reason = 'membership_removed'/i);
});

test("iOS push capability and Capacitor bridge wiring stay in the native target", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const appDelegate = readFileSync(join(repoRoot, "ios/App/App/AppDelegate.swift"), "utf8");
  const entitlements = readFileSync(join(repoRoot, "ios/App/App/App.entitlements"), "utf8");
  const swiftPackage = readFileSync(join(repoRoot, "ios/App/CapApp-SPM/Package.swift"), "utf8");
  const capacitorConfig = readFileSync(join(repoRoot, "capacitor.config.ts"), "utf8");

  assert.match(appDelegate, /capacitorDidRegisterForRemoteNotifications/);
  assert.match(appDelegate, /capacitorDidFailToRegisterForRemoteNotifications/);
  assert.match(entitlements, /aps-environment/);
  assert.match(swiftPackage, /CapacitorPushNotifications/);
  assert.match(capacitorConfig, /PushNotifications:[\s\S]*presentationOptions:\s*\[\]/);
});
