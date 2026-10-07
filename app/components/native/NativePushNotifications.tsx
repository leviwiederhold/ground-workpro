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
      const platform = String(capacitor?.getPlatform?.() ?? "").toLowerCase();
      if (capacitor?.isNativePlatform?.() !== true || !["ios", "android"].includes(platform)) {
        return;
      }

      const { PushNotifications } = await import("@capacitor/push-notifications");
      if (platform === "android") {
        // FCM references this stable channel id. Creating it before registration
        // avoids Android silently falling back to a generic provider channel.
        await PushNotifications.createChannel({
          id: "groundwork_messages",
          name: "Messages",
          description: "New Groundwork Pro conversation messages",
          importance: 4,
          visibility: 1,
          vibration: true,
        });
      }
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
