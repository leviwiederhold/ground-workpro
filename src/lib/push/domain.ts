export type PushPlatform = "ios" | "android";
export type PushEnvironment = "sandbox" | "production";

export type PushDeviceCandidate = {
  id: string;
  company_id: string;
  user_id: string;
  platform: PushPlatform;
  device_id: string;
  push_token: string;
  push_environment: PushEnvironment;
  enabled: boolean;
  revoked_at?: string | null;
};

export type ApnsResponseClassification = {
  invalidToken: boolean;
  retryable: boolean;
};

export type FcmResponseClassification = ApnsResponseClassification;

const INVALID_APNS_TOKEN_REASONS = new Set([
  "BadDeviceToken",
  "DeviceTokenNotForTopic",
  "ExpiredToken",
  "Unregistered",
]);

const RETRYABLE_APNS_REASONS = new Set([
  "ExpiredProviderToken",
  "IdleTimeout",
  "InternalServerError",
  "ServiceUnavailable",
  "Shutdown",
  "TooManyProviderTokenUpdates",
  "TooManyRequests",
]);

const INVALID_FCM_TOKEN_CODES = new Set([
  "UNREGISTERED",
  "SENDER_ID_MISMATCH",
  "INVALID_ARGUMENT",
]);

const RETRYABLE_FCM_CODES = new Set([
  "INTERNAL",
  "INTERNAL_SERVER_ERROR",
  "RESOURCE_EXHAUSTED",
  "UNAVAILABLE",
]);

export function selectEligiblePushDevices(input: {
  companyId: string;
  senderUserId: string;
  participantUserIds: string[];
  activeMemberUserIds: string[];
  devices: PushDeviceCandidate[];
}): PushDeviceCandidate[] {
  const activeMembers = new Set(input.activeMemberUserIds.map(String));
  const recipients = new Set(
    input.participantUserIds
      .map(String)
      .filter((userId) => userId && userId !== String(input.senderUserId) && activeMembers.has(userId))
  );

  return input.devices.filter((device) => {
    return (
      device.company_id === input.companyId &&
      recipients.has(String(device.user_id)) &&
      device.enabled === true &&
      !device.revoked_at &&
      Boolean(device.push_token)
    );
  });
}

function normalizedPreviewText(value: string): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function truncatePushPreview(value: string, maxLength = 120): string {
  const normalized = normalizedPreviewText(value);
  if (normalized.length <= maxLength) return normalized;
  const safeLimit = Math.max(1, maxLength - 1);
  return `${normalized.slice(0, safeLimit).trimEnd()}…`;
}

export function buildMessagePushContent(input: {
  senderName: string;
  messageBody: string;
  attachmentCount?: number;
}) {
  const senderName = normalizedPreviewText(input.senderName) || "Team Member";
  const body = truncatePushPreview(input.messageBody);
  const attachmentCount = Math.max(0, Number(input.attachmentCount ?? 0));
  const fallback =
    attachmentCount === 1
      ? "Sent an attachment"
      : attachmentCount > 1
        ? `Sent ${attachmentCount} attachments`
        : "Sent a message";

  return {
    title: `New message from ${senderName}`,
    body: body || fallback,
  };
}

export function classifyApnsResponse(status: number, reason: string | null): ApnsResponseClassification {
  const normalizedReason = String(reason ?? "");
  if (status === 200) return { invalidToken: false, retryable: false };
  if (status === 410 || INVALID_APNS_TOKEN_REASONS.has(normalizedReason)) {
    return { invalidToken: true, retryable: false };
  }
  if (status === 429 || status >= 500 || RETRYABLE_APNS_REASONS.has(normalizedReason)) {
    return { invalidToken: false, retryable: true };
  }
  return { invalidToken: false, retryable: false };
}

/** Classify only the provider's FcmError code. A generic HTTP 400 is not enough
 * to revoke a token because it can also describe a malformed server payload. */
export function classifyFcmResponse(
  status: number,
  errorCode: string | null,
): FcmResponseClassification {
  const normalizedCode = String(errorCode ?? "").toUpperCase();
  if (status >= 200 && status < 300) return { invalidToken: false, retryable: false };
  if (INVALID_FCM_TOKEN_CODES.has(normalizedCode)) {
    return { invalidToken: true, retryable: false };
  }
  if (status === 429 || status >= 500 || RETRYABLE_FCM_CODES.has(normalizedCode)) {
    return { invalidToken: false, retryable: true };
  }
  return { invalidToken: false, retryable: false };
}

export function getPushRetryAt(attempt: number, from = new Date()): string {
  const safeAttempt = Math.max(1, attempt);
  const delaySeconds = Math.min(15 * 60, 15 * 2 ** (safeAttempt - 1));
  return new Date(from.getTime() + delaySeconds * 1000).toISOString();
}

export async function enqueueMessagePushSafely(
  enqueue: () => Promise<unknown>,
  onError: (error: unknown) => void = () => undefined
): Promise<boolean> {
  try {
    await enqueue();
    return true;
  } catch (error) {
    onError(error);
    return false;
  }
}
