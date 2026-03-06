import * as fs from "node:fs";
import * as path from "node:path";

type FallbackChecklistRow = {
  company_id: string;
  user_id: string | null;
  key: string;
  completed_at: string | null;
  completed_by: string | null;
  updated_at: string;
};

type FallbackStore = {
  checklist: FallbackChecklistRow[];
};

const fallbackFilePath = path.join("/tmp", "groundwork-fallback-onboarding.json");

function readStore(): FallbackStore {
  try {
    if (!fs.existsSync(fallbackFilePath)) return { checklist: [] };
    const raw = fs.readFileSync(fallbackFilePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { checklist: [] };
    return { checklist: Array.isArray(parsed.checklist) ? parsed.checklist : [] };
  } catch {
    return { checklist: [] };
  }
}

function writeStore(store: FallbackStore) {
  try {
    fs.writeFileSync(fallbackFilePath, JSON.stringify(store), "utf8");
  } catch {
    // no-op
  }
}

export function listFallbackChecklistRows(companyId: string) {
  return readStore().checklist.filter((row) => row.company_id === companyId);
}

export function upsertFallbackChecklistRow(input: {
  companyId: string;
  userId: string | null;
  key: string;
  completedAt: string | null;
  completedBy: string | null;
}) {
  const store = readStore();
  const idx = store.checklist.findIndex(
    (row) =>
      row.company_id === input.companyId &&
      String(row.user_id ?? "") === String(input.userId ?? "") &&
      row.key === input.key
  );

  const next: FallbackChecklistRow = {
    company_id: input.companyId,
    user_id: input.userId,
    key: input.key,
    completed_at: input.completedAt,
    completed_by: input.completedBy,
    updated_at: new Date().toISOString(),
  };

  if (idx >= 0) store.checklist[idx] = next;
  else store.checklist.push(next);
  writeStore(store);
  return next;
}

