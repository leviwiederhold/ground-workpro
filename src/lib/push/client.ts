import {
  ACTIVE_MESSAGE_THREAD_KEY,
  buildMessageThreadHref,
  getMessageThreadIdFromPushData,
  PENDING_MESSAGE_THREAD_KEY,
  shouldSuppressForegroundMessagePush,
} from "@/lib/push/navigation";

const PUSH_DEVICE_ID_KEY = "groundwork.push.deviceId.v1";
export const MESSAGE_PUSH_RECEIVED_EVENT = "groundwork:message-push-received";

type PushPlatform = "ios" | "android";

function nativePlatform(): PushPlatform | null {
  if (typeof window === "undefined") return null;
  const capacitor = (window as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
  }).Capacitor;
  if (capacitor?.isNativePlatform?.() !== true) return null;
  const platform = String(capacitor.getPlatform?.() ?? "").toLowerCase();
  return platform === "ios" || platform === "android" ? platform : null;
}

export function getOrCreatePushDeviceId(): string {
  if (typeof window === "undefined") return "";
  try {
    const current = window.localStorage.getItem(PUSH_DEVICE_ID_KEY);
    if (current) return current;
    const created = globalThis.crypto?.randomUUID?.() ?? `device-${Date.now()}-${Math.random()}`;
    window.localStorage.setItem(PUSH_DEVICE_ID_KEY, created);
    return created;
  } catch {
    return `device-${Date.now()}-${Math.random()}`;
  }
}

function pushEnvironment(): "sandbox" | "production" {
  if (typeof window === "undefined") return "production";
  const marker = (window as unknown as { __GROUNDWORK_PUSH_ENVIRONMENT__?: string })
    .__GROUNDWORK_PUSH_ENVIRONMENT__;
  return marker === "sandbox" ? "sandbox" : "production";
}

export async function persistNativePushToken(token: string): Promise<boolean> {
  const platform = nativePlatform();
  if (!platform || !token) return false;
  const response = await fetch("/api/push/devices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      platform,
      deviceId: getOrCreatePushDeviceId(),
      token,
      environment: platform === "ios" ? pushEnvironment() : "production",
    }),
  });
  return response.ok;
}

export function routeMessagePush(data: unknown): boolean {
  if (typeof window === "undefined") return false;
  const threadId = getMessageThreadIdFromPushData(data);
  const href = threadId ? buildMessageThreadHref(threadId) : null;
  if (!threadId || !href) return false;
  try {
    window.localStorage.setItem("app.currentView", "messages");
    window.localStorage.setItem(PENDING_MESSAGE_THREAD_KEY, threadId);
  } catch {
    // Navigation still works when storage is unavailable.
  }
  window.location.assign(href);
  return true;
}

export function handleForegroundMessagePush(data: unknown): {
  handled: boolean;
  suppressedForOpenConversation: boolean;
} {
  if (typeof window === "undefined") {
    return { handled: false, suppressedForOpenConversation: false };
  }
  const threadId = getMessageThreadIdFromPushData(data);
  if (!threadId) return { handled: false, suppressedForOpenConversation: false };
  let activeThreadId = "";
  try {
    activeThreadId = window.localStorage.getItem(ACTIVE_MESSAGE_THREAD_KEY) ?? "";
  } catch {
    // Treat storage failures as no active conversation.
  }
  const suppressedForOpenConversation = shouldSuppressForegroundMessagePush({
    pathname: window.location.pathname,
    activeThreadId,
    incomingThreadId: threadId,
  });
  window.dispatchEvent(
    new CustomEvent(MESSAGE_PUSH_RECEIVED_EVENT, {
      detail: { threadId, suppressedForOpenConversation },
    })
  );
  return { handled: true, suppressedForOpenConversation };
}

export async function revokeCurrentNativePushDevice(): Promise<void> {
  const platform = nativePlatform();
  if (!platform || typeof window === "undefined") return;
  const deviceId = getOrCreatePushDeviceId();
  await fetch("/api/push/devices", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platform, deviceId }),
  }).catch(() => null);

  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    await PushNotifications.unregister();
  } catch {
    // Logout must continue even if native unregistration is unavailable.
  }
}
