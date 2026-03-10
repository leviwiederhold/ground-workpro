import * as fs from "node:fs";
import * as path from "node:path";
import type { NotificationPayload, NotificationType } from "@/lib/notifications/format";

type FallbackNotification = {
  id: string;
  company_id: string;
  user_id: string;
  type: NotificationType;
  payload: NotificationPayload;
  is_read?: boolean;
  read_at: string | null;
  created_at: string;
};

type FallbackStore = {
  notifications: FallbackNotification[];
};

const fallbackFilePath = path.join("/tmp", "groundwork-fallback-notifications.json");

function readStore(): FallbackStore {
  try {
    if (!fs.existsSync(fallbackFilePath)) {
      return { notifications: [] };
    }
    const raw = fs.readFileSync(fallbackFilePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { notifications: [] };
    }
    return {
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
    };
  } catch {
    return { notifications: [] };
  }
}

function writeStore(store: FallbackStore) {
  try {
    fs.writeFileSync(fallbackFilePath, JSON.stringify(store), "utf8");
  } catch {
    // no-op fallback path
  }
}

export function createFallbackNotifications(input: {
  companyId: string;
  userIds: string[];
  type: NotificationType;
  payload: NotificationPayload;
}) {
  const store = readStore();
  const now = new Date().toISOString();
  const rows = Array.from(new Set(input.userIds.map((id) => String(id)).filter(Boolean))).map((userId) => ({
    id: crypto.randomUUID(),
    company_id: input.companyId,
    user_id: userId,
    type: input.type,
    payload: input.payload,
    read_at: null,
    created_at: now,
  })) as FallbackNotification[];
  store.notifications.push(...rows);
  writeStore(store);
  return rows;
}

export function listFallbackNotifications(input: {
  companyId: string;
  userId: string;
  companyWide: boolean;
  limit?: number;
}) {
  const rows = readStore()
    .notifications.filter((row) => {
      if (row.company_id !== input.companyId) return false;
      return true;
    })
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  if (!input.limit || input.limit <= 0) return rows;
  return rows.slice(0, input.limit);
}

export function countFallbackUnread(input: {
  companyId: string;
  userId: string;
  companyWide: boolean;
}) {
  return readStore().notifications.filter((row) => {
    if (row.company_id !== input.companyId) return false;
    return !(row.is_read ?? Boolean(row.read_at));
  }).length;
}

export function markFallbackNotificationRead(input: {
  companyId: string;
  notificationId: string;
  userId: string;
  companyWide: boolean;
}) {
  const store = readStore();
  const row = store.notifications.find((candidate) => {
    if (candidate.company_id !== input.companyId) return false;
    if (String(candidate.id) !== String(input.notificationId)) return false;
    return true;
  });
  if (!row) return null;
  row.is_read = true;
  row.read_at = new Date().toISOString();
  writeStore(store);
  return row;
}

export function markAllFallbackNotificationsRead(input: {
  companyId: string;
  userId: string;
  companyWide: boolean;
}) {
  const store = readStore();
  let updated = 0;
  const now = new Date().toISOString();
  for (const row of store.notifications) {
    if (row.company_id !== input.companyId) continue;
    if (row.user_id !== input.userId) continue;
    if (row.is_read ?? Boolean(row.read_at)) continue;
    row.is_read = true;
    row.read_at = now;
    updated += 1;
  }
  writeStore(store);
  return updated;
}
