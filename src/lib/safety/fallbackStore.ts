import * as fs from "node:fs";
import * as path from "node:path";

type FallbackSafetyLog = {
  id: string;
  company_id: string;
  occurred_on: string;
  summary: string;
  severity: "low" | "medium" | "high";
  created_at: string;
  updated_at: string;
};

const fallbackFilePath = path.join("/tmp", "groundwork-fallback-safety-logs.json");

function readStore(): FallbackSafetyLog[] {
  try {
    if (!fs.existsSync(fallbackFilePath)) {
      return [];
    }
    const raw = fs.readFileSync(fallbackFilePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as FallbackSafetyLog[];
  } catch {
    return [];
  }
}

function writeStore(items: FallbackSafetyLog[]) {
  try {
    fs.writeFileSync(fallbackFilePath, JSON.stringify(items), "utf8");
  } catch {
    // no-op
  }
}

export function listFallbackSafetyLogs(companyId: string): FallbackSafetyLog[] {
  return readStore()
    .filter((item) => item.company_id === companyId)
    .sort((a, b) => String(b.occurred_on).localeCompare(String(a.occurred_on)));
}

export function createFallbackSafetyLog(input: {
  companyId: string;
  occurred_on: string;
  summary: string;
  severity: "low" | "medium" | "high";
}): FallbackSafetyLog {
  const store = readStore();
  const now = new Date().toISOString();
  const created: FallbackSafetyLog = {
    id: crypto.randomUUID(),
    company_id: input.companyId,
    occurred_on: input.occurred_on,
    summary: input.summary,
    severity: input.severity,
    created_at: now,
    updated_at: now,
  };
  store.unshift(created);
  writeStore(store);
  return created;
}

export function deleteFallbackSafetyLog(companyId: string, id: string): boolean {
  const store = readStore();
  const idx = store.findIndex((item) => item.company_id === companyId && item.id === id);
  if (idx < 0) return false;
  store.splice(idx, 1);
  writeStore(store);
  return true;
}
