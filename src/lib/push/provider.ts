import "server-only";

import { sendApnsNotification, type ApnsSendResult } from "@/lib/push/apns";
import { sendFcmNotification } from "@/lib/push/fcm";
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

  return sendFcmNotification({
    token: input.device.push_token,
    title: input.title,
    body: input.body,
    threadId: input.threadId,
    messageId: input.messageId,
  });
}
