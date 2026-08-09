"use client";

import { useEffect } from "react";
import type { PluginListenerHandle } from "@capacitor/core";
import {
  handleForegroundMessagePush,
  persistNativePushToken,
  revokeCurrentNativePushDevice,
  routeMessagePush,
} from "@/lib/push/client";

export function NativePushNotifications() {
  useEffect(() => {
    let disposed = false;
    const listeners: PluginListenerHandle[] = [];

    const setup = async () => {
      const capacitor = (window as unknown as {
        Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
      }).Capacitor;
      if (
        capacitor?.isNativePlatform?.() !== true ||
        String(capacitor.getPlatform?.() ?? "").toLowerCase() !== "ios"
      ) {
        return;
      }

      const { PushNotifications } = await import("@capacitor/push-notifications");
      listeners.push(
        await PushNotifications.addListener("registration", (registration) => {
          void persistNativePushToken(String(registration.value ?? "")).catch(() => undefined);
        }),
        await PushNotifications.addListener("registrationError", (error) => {
          console.warn("[push] Native registration failed", String(error.error ?? "unknown error"));
        }),
        await PushNotifications.addListener("pushNotificationReceived", (notification) => {
          handleForegroundMessagePush(notification.data);
        }),
        await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
          routeMessagePush(action.notification.data);
        })
      );

      const syncRegistration = async (allowPrompt: boolean) => {
        const permission = await PushNotifications.checkPermissions();
        const resolvedPermission =
          allowPrompt && permission.receive === "prompt"
            ? (await PushNotifications.requestPermissions()).receive
            : permission.receive;
        if (disposed) return;
        if (resolvedPermission === "granted") {
          await PushNotifications.register();
        } else if (resolvedPermission === "denied") {
          // Keep the durable registration truthful when permission is revoked
          // in iOS Settings after this installation previously registered.
          await revokeCurrentNativePushDevice();
        }
      };

      await syncRegistration(true);

      const registerOnForeground = () => {
        if (!disposed && document.visibilityState === "visible") {
          // Settings may have changed while the app was backgrounded. This
          // also obtains rotated APNs tokens without presenting another prompt.
          void syncRegistration(false).catch(() => undefined);
        }
      };
      document.addEventListener("visibilitychange", registerOnForeground);
      listeners.push({ remove: async () => document.removeEventListener("visibilitychange", registerOnForeground) });
    };

    void setup().catch((error) => {
      console.warn("[push] Native push setup failed", error instanceof Error ? error.message : "unknown error");
    });

    return () => {
      disposed = true;
      for (const listener of listeners) void listener.remove();
    };
  }, []);

  return null;
}
