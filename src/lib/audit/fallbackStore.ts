type FallbackAuditLog = {
  id: string;
  company_id: string;
  actor_user_id: string | null;
  event_type: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

const globalAuditStoreKey = "__groundworkFallbackAuditLogs";

function getStore(): FallbackAuditLog[] {
  const globalValue = globalThis as typeof globalThis & {
    [globalAuditStoreKey]?: FallbackAuditLog[];
  };
  if (!globalValue[globalAuditStoreKey]) {
    globalValue[globalAuditStoreKey] = [];
  }
  return globalValue[globalAuditStoreKey]!;
}

export function pushFallbackAuditLog(item: Omit<FallbackAuditLog, "id" | "created_at">) {
  const store = getStore();
  store.unshift({
    ...item,
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
  });
  if (store.length > 500) {
    store.length = 500;
  }
}

export function getFallbackAuditLogs(companyId: string): FallbackAuditLog[] {
  return getStore().filter((item) => item.company_id === companyId);
}
