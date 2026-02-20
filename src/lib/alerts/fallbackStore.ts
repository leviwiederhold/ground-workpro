import type { AlertCandidate } from "@/lib/alerts/generateAlerts";

type FallbackAlert = {
  id: string;
  company_id: string;
  alert_type: string;
  title: string;
  message: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  updated_at: string;
};

const alertsStoreKey = "__groundworkFallbackAlerts";

function getStore(): FallbackAlert[] {
  const globalValue = globalThis as typeof globalThis & {
    [alertsStoreKey]?: FallbackAlert[];
  };
  if (!globalValue[alertsStoreKey]) {
    globalValue[alertsStoreKey] = [];
  }
  return globalValue[alertsStoreKey]!;
}

export function syncFallbackAlerts(companyId: string, candidates: AlertCandidate[]): FallbackAlert[] {
  const store = getStore();
  const now = new Date().toISOString();
  const activeIds = new Set<string>();

  for (const candidate of candidates) {
    const id = `${companyId}:${candidate.dedupe_key}`;
    activeIds.add(id);
    const existingIndex = store.findIndex((item) => item.id === id);
    if (existingIndex >= 0) {
      const existing = store[existingIndex];
      store[existingIndex] = {
        ...existing,
        alert_type: candidate.alert_type,
        title: candidate.title,
        message: candidate.message,
        entity_type: candidate.entity_type,
        entity_id: candidate.entity_id,
        metadata: candidate.metadata,
        updated_at: now,
      };
      continue;
    }

    store.push({
      id,
      company_id: companyId,
      alert_type: candidate.alert_type,
      title: candidate.title,
      message: candidate.message,
      entity_type: candidate.entity_type,
      entity_id: candidate.entity_id,
      metadata: candidate.metadata,
      is_read: false,
      read_at: null,
      created_at: now,
      updated_at: now,
    });
  }

  for (let i = store.length - 1; i >= 0; i -= 1) {
    if (store[i].company_id !== companyId) continue;
    if (!activeIds.has(store[i].id)) {
      store.splice(i, 1);
    }
  }

  return store
    .filter((item) => item.company_id === companyId)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

export function getFallbackAlerts(companyId: string): FallbackAlert[] {
  return getStore()
    .filter((item) => item.company_id === companyId)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

export function markFallbackAlertRead(companyId: string, alertId: string): boolean {
  const store = getStore();
  const idx = store.findIndex((item) => item.company_id === companyId && item.id === alertId);
  if (idx < 0) return false;
  const now = new Date().toISOString();
  store[idx] = {
    ...store[idx],
    is_read: true,
    read_at: now,
    updated_at: now,
  };
  return true;
}
