/* eslint-disable @typescript-eslint/no-explicit-any */
// Durable storage for the offline attendance queue.
//
// Where the queue lives matters. localStorage inside a WKWebView/WebView is
// evictable: iOS can clear web data under storage pressure, and an Android
// "clear cache" wipes it. Attendance that survives being offline but not being
// backgrounded for two days is not durable.
//
// So the queue is stored NATIVELY when a native store is available — an app-
// container file with data protection on iOS, app-private internal storage on
// Android, neither of which is user-visible or evictable — and falls back to
// localStorage on the web and on native builds that have not bundled the
// plugin. Reads try native first and fall back, so an app that gains the plugin
// in an update inherits whatever localStorage was already holding.
//
// The queue holds no secrets (the credential lives in the Keychain/Keystore via
// SecureAttendanceStore), so the native store is about DURABILITY, not secrecy.

import {
  normalizeStoredQueue,
  QUEUE_SCHEMA_VERSION,
  type QueuedAttendanceEvent,
} from "./offlineQueue.ts";

const STORAGE_KEY = "attendance.offlineQueue.v1";
const META_KEY = "attendance.offlineQueue.meta.v1";

/**
 * Native durable-store contract. Implemented by the AttendanceQueueStore plugin
 * (see ios/App/App/AttendanceQueueStorePlugin.swift and the Android
 * equivalent). Absent on the web and on builds without the plugin.
 */
export interface AttendanceQueueStorePlugin {
  load(): Promise<{ value: string | null }>;
  save(options: { value: string }): Promise<void>;
  clear(): Promise<void>;
}

function nativeStore(): AttendanceQueueStorePlugin | null {
  if (typeof window === "undefined") return null;
  const cap = (window as any).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  return (cap.Plugins?.AttendanceQueueStore as AttendanceQueueStorePlugin | undefined) ?? null;
}

export function isNativeQueueStoreAvailable(): boolean {
  return nativeStore() !== null;
}

export type QueueMeta = {
  lastSuccessfulSyncAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
};

export const EMPTY_META: QueueMeta = {
  lastSuccessfulSyncAt: null,
  lastFailureAt: null,
  lastFailureReason: null,
};

type Envelope = {
  version: number;
  events: unknown;
  meta?: Partial<QueueMeta>;
};

function readLocal(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage full / unavailable — the native store is the durable path */
  }
}

function parseEnvelope(raw: string | null): { events: unknown; meta: QueueMeta } {
  if (!raw) return { events: [], meta: { ...EMPTY_META } };
  try {
    const parsed = JSON.parse(raw) as Envelope | unknown[];
    // A v1 payload was a bare array; a v2 payload is an envelope.
    if (Array.isArray(parsed)) return { events: parsed, meta: { ...EMPTY_META } };
    const envelope = parsed as Envelope;
    return {
      events: envelope?.events ?? [],
      meta: { ...EMPTY_META, ...(envelope?.meta ?? {}) },
    };
  } catch {
    // Corrupted (e.g. a kill mid-write). Better an empty queue than a throw
    // that breaks every attendance path on this device.
    return { events: [], meta: { ...EMPTY_META } };
  }
}

/**
 * Load the queue. Native first; falls back to localStorage when the native
 * store is absent OR empty, so an app that gains the plugin in an update does
 * not strand events written by the previous build.
 */
export async function loadQueue(now?: string): Promise<{ queue: QueuedAttendanceEvent[]; meta: QueueMeta }> {
  const store = nativeStore();
  if (store) {
    try {
      const native = await store.load();
      if (native?.value) {
        const { events, meta } = parseEnvelope(native.value);
        const queue = normalizeStoredQueue(events, now);
        if (queue.length > 0 || meta.lastSuccessfulSyncAt) return { queue, meta };
      }
    } catch {
      /* fall through to localStorage */
    }
  }
  const { events, meta } = parseEnvelope(readLocal(STORAGE_KEY));
  const legacyMeta = parseEnvelope(readLocal(META_KEY)).meta;
  return {
    queue: normalizeStoredQueue(events, now),
    meta: meta.lastSuccessfulSyncAt || meta.lastFailureAt ? meta : legacyMeta,
  };
}

/**
 * Persist the queue. Written to BOTH stores when native is available: the
 * native copy is the durable one, and the localStorage copy keeps synchronous
 * diagnostics readers working without an await.
 */
export async function saveQueue(queue: QueuedAttendanceEvent[], meta: QueueMeta): Promise<void> {
  const payload = JSON.stringify({ version: QUEUE_SCHEMA_VERSION, events: queue, meta } satisfies Envelope);
  const store = nativeStore();
  if (store) {
    try {
      await store.save({ value: payload });
    } catch {
      /* best effort; the localStorage write below still happens */
    }
  }
  writeLocal(STORAGE_KEY, payload);
}

export async function clearQueue(): Promise<void> {
  const store = nativeStore();
  if (store) {
    try {
      await store.clear();
    } catch {
      /* ignore */
    }
  }
  writeLocal(STORAGE_KEY, JSON.stringify({ version: QUEUE_SCHEMA_VERSION, events: [], meta: EMPTY_META }));
}

/**
 * Synchronous best-effort read of the localStorage mirror, for diagnostics
 * surfaces that cannot await. Never used to decide what to submit.
 */
export function peekQueueSync(): { queue: QueuedAttendanceEvent[]; meta: QueueMeta } {
  const { events, meta } = parseEnvelope(readLocal(STORAGE_KEY));
  return { queue: normalizeStoredQueue(events), meta };
}
