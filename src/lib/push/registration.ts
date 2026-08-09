import { z } from "zod";
import type { PushEnvironment, PushPlatform } from "@/lib/push/domain";

export const pushDeviceRegistrationSchema = z
  .object({
    platform: z.enum(["ios", "android"]),
    deviceId: z.string().trim().min(8).max(200),
    token: z.string().trim().min(16).max(4096),
    environment: z.enum(["sandbox", "production"]).optional().default("production"),
  })
  .superRefine((data, ctx) => {
    if (data.platform === "ios" && !/^[a-fA-F0-9]+$/.test(data.token)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["token"],
        message: "Invalid iOS push token",
      });
    }
  });

export const pushDeviceRevocationSchema = z.object({
  platform: z.enum(["ios", "android"]),
  deviceId: z.string().trim().min(8).max(200),
});

export type PushDeviceRegistration = {
  platform: PushPlatform;
  deviceId: string;
  token: string;
  environment: PushEnvironment;
};

export function pushDeviceIdentityKey(platform: PushPlatform, deviceId: string): string {
  return `${platform}:${deviceId}`;
}

export function didPushTokenRotate(
  previous: Pick<PushDeviceRegistration, "platform" | "deviceId" | "token">,
  next: Pick<PushDeviceRegistration, "platform" | "deviceId" | "token">
): boolean {
  return (
    pushDeviceIdentityKey(previous.platform, previous.deviceId) ===
      pushDeviceIdentityKey(next.platform, next.deviceId) && previous.token !== next.token
  );
}
