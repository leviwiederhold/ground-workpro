import * as fs from "node:fs";
import * as path from "node:path";

export type FallbackAssignment = {
  id: string;
  company_id: string;
  job_id: string;
  date: string;
  employee_id: string | null;
  equipment_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
};

type FallbackStore = {
  assignments: FallbackAssignment[];
};

const fallbackFilePath = path.join("/tmp", "groundwork-fallback-schedule.json");

function readStore(): FallbackStore {
  try {
    if (!fs.existsSync(fallbackFilePath)) return { assignments: [] };
    const raw = fs.readFileSync(fallbackFilePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { assignments: [] };
    return { assignments: Array.isArray(parsed.assignments) ? parsed.assignments : [] };
  } catch {
    return { assignments: [] };
  }
}

function writeStore(store: FallbackStore) {
  try {
    fs.writeFileSync(fallbackFilePath, JSON.stringify(store), "utf8");
  } catch {
    // no-op
  }
}

export function createFallbackAssignment(input: Omit<FallbackAssignment, "id" | "created_at">) {
  const store = readStore();
  const assignment: FallbackAssignment = {
    ...input,
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
  };
  store.assignments.push(assignment);
  writeStore(store);
  return assignment;
}

export function listFallbackAssignmentsForWeek(companyId: string, weekStart: string, weekEnd: string) {
  return readStore().assignments
    .filter((assignment) => {
      if (assignment.company_id !== companyId) return false;
      return assignment.date >= weekStart && assignment.date <= weekEnd;
    })
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

export function listFallbackAssignmentsForDate(companyId: string, date: string) {
  return readStore().assignments.filter((assignment) => assignment.company_id === companyId && assignment.date === date);
}
