const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PENDING_MESSAGE_THREAD_KEY = "groundwork.push.pendingMessageThread";
export const ACTIVE_MESSAGE_THREAD_KEY = "groundwork.messages.activeThread";

export function getMessageThreadIdFromPushData(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  const candidate = String(record.threadId ?? record.thread_id ?? "").trim();
  return UUID_PATTERN.test(candidate) ? candidate : null;
}

export function buildMessageThreadHref(threadId: string): string | null {
  if (!UUID_PATTERN.test(String(threadId))) return null;
  return `/messages?thread=${encodeURIComponent(threadId)}`;
}

export function shouldSuppressForegroundMessagePush(input: {
  pathname: string;
  activeThreadId: string | null | undefined;
  incomingThreadId: string | null | undefined;
}): boolean {
  return (
    String(input.pathname).replace(/\/+$/, "") === "/messages" &&
    Boolean(input.incomingThreadId) &&
    String(input.activeThreadId ?? "") === String(input.incomingThreadId)
  );
}
