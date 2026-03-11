"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type NotificationItem = {
  id: string;
  title: string;
  message: string;
  link?: string;
  payload?: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
};

function getNotificationHref(item: NotificationItem) {
  const direct = String(item?.link ?? "").trim();
  if (direct) return direct;
  const payloadHref = String((item?.payload as { href?: unknown } | undefined)?.href ?? "").trim();
  return payloadHref;
}

function formatNotificationTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function NotificationsPage() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const unreadCount = useMemo(
    () => items.filter((item) => !item.is_read).length,
    [items]
  );

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const response = await fetch("/api/notifications?limit=100", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(String(payload?.error || "Failed to load notifications."));
        return;
      }
      setItems((payload?.items || []) as NotificationItem[]);
    } catch {
      setError("Failed to load notifications.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const markOneRead = useCallback(async (id: string) => {
    try {
      const rawId = String(id).startsWith("n:") ? String(id).slice(2) : String(id);
      const response = await fetch(`/api/notifications/${rawId}/read`, { method: "POST" });
      if (!response.ok) return;
      setItems((prev) =>
        prev.map((item) => (String(item.id) === String(id) ? { ...item, is_read: true } : item))
      );
    } catch {
      // no-op
    }
  }, []);

  const markAllRead = useCallback(async () => {
    if (!items.some((item) => !item.is_read)) return;
    const response = await fetch("/api/notifications/read-all", { method: "POST" });
    if (!response.ok) return;
    setItems((prev) => prev.map((item) => ({ ...item, is_read: true })));
  }, [items]);

  const clearRead = useCallback(async () => {
    if (!items.some((item) => item.is_read)) return;
    const response = await fetch("/api/notifications/clear-read", { method: "POST" });
    if (!response.ok) return;
    setItems((prev) => prev.filter((item) => !item.is_read));
  }, [items]);

  const visibleItems = useMemo(
    () => (filter === "unread" ? items.filter((item) => !item.is_read) : items),
    [items, filter]
  );

  const openItem = useCallback(async (item: NotificationItem) => {
    const href = getNotificationHref(item);
    if (!href) return;
    if (!item.is_read) await markOneRead(item.id);
    window.location.assign(href);
  }, [markOneRead]);

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-3xl overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-3">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Notifications</h1>
            <p className="text-xs text-gray-500">{unreadCount} unread</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-60"
              onClick={markAllRead}
              disabled={!items.some((item) => !item.is_read)}
            >
              Mark all read
            </button>
            <button
              className="text-xs font-medium text-gray-600 hover:text-gray-800 disabled:opacity-60"
              onClick={clearRead}
              disabled={!items.some((item) => item.is_read)}
            >
              Clear read
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
          <button
            className={`rounded px-2 py-1 text-xs ${filter === "all" ? "bg-brand-100 text-brand-700" : "text-gray-600 hover:bg-gray-100"}`}
            onClick={() => setFilter("all")}
          >
            All
          </button>
          <button
            className={`rounded px-2 py-1 text-xs ${filter === "unread" ? "bg-brand-100 text-brand-700" : "text-gray-600 hover:bg-gray-100"}`}
            onClick={() => setFilter("unread")}
          >
            Unread
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto">
          {loading ? (
            <div className="px-4 py-4 text-sm text-gray-500">Loading notifications...</div>
          ) : error ? (
            <div className="px-4 py-4 text-sm text-red-600">{error}</div>
          ) : visibleItems.length === 0 ? (
            <div className="px-4 py-4 text-sm text-gray-500">No notifications.</div>
          ) : (
            visibleItems.map((item) => (
              <div key={item.id} className={`border-b border-gray-100 px-4 py-3 ${item.is_read ? "bg-white" : "bg-brand-50/30"}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-gray-900">{item.title}</p>
                  {!item.is_read && <span className="h-2 w-2 rounded-full bg-brand-500" />}
                </div>
                <p className="mt-1 text-sm text-gray-600">{item.message}</p>
                <div className="mt-2 flex items-center justify-between">
                  <p className="text-xs text-gray-400">{formatNotificationTime(item.created_at)}</p>
                  <div className="flex items-center gap-3">
                    {Boolean(getNotificationHref(item)) && (
                      <button className="text-xs font-medium text-gray-600 hover:text-gray-800" onClick={() => openItem(item)}>
                        Open
                      </button>
                    )}
                    {!item.is_read && (
                      <button className="text-xs font-medium text-brand-600 hover:text-brand-700" onClick={() => markOneRead(item.id)}>
                        Mark read
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
