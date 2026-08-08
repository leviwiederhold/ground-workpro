import "server-only";

import { sendApnsNotification, type ApnsSendResult } from "@/lib/push/apns";
import type { PushDeviceCandidate } from "@/lib/push/domain";

export type PushProviderResult = ApnsSendResult;

export async function sendMessagePushToDevice(input: {
  device: PushDeviceCandidate;
  title: string;
  body: string;
  threadId: string;
  messageId: string;
}): Promise<PushProviderResult> {
  if (input.device.platform === "ios") {
    return sendApnsNotification({
      token: input.device.push_token,
      environment: input.device.push_environment,
      title: input.title,
      body: input.body,
      threadId: input.threadId,
      messageId: input.messageId,
    });
  }

  // The durable model and provider boundary are Android-ready, but FCM remains
  // deliberately unconfigured until the Android release work supplies a Google
  // service account and google-services.json.
  return {
    ok: false,
    status: 501,
    providerId: null,
    reason: "AndroidPushProviderNotConfigured",
    invalidToken: false,
    retryable: false,
  };
}
