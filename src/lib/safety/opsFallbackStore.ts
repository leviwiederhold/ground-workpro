type SafetyAction = {
  id: string;
  company_id: string;
  safety_log_id: string;
  job_id: string | null;
  title: string;
  description: string | null;
  owner_employee_id: string | null;
  due_date: string | null;
  status: "open" | "in_progress" | "closed";
  priority: "low" | "medium" | "high";
  closed_at: string | null;
  closed_by: string | null;
  closure_notes: string | null;
  created_at: string;
  updated_at: string;
};

type ToolboxTalk = {
  id: string;
  company_id: string;
  job_id: string | null;
  topic: string;
  summary: string | null;
  occurred_on: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  attendee_employee_ids: string[];
  attendees_count: number;
};

const safetyActions = new Map<string, SafetyAction[]>();
const toolboxTalks = new Map<string, ToolboxTalk[]>();

function nowIso() {
  return new Date().toISOString();
}

function nextId() {
  return crypto.randomUUID();
}

export function listFallbackSafetyActions(companyId: string) {
  return [...(safetyActions.get(companyId) ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function createFallbackSafetyAction(input: Omit<SafetyAction, "id" | "created_at" | "updated_at">) {
  const action: SafetyAction = {
    ...input,
    id: nextId(),
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  const current = safetyActions.get(input.company_id) ?? [];
  safetyActions.set(input.company_id, [action, ...current]);
  return action;
}

export function updateFallbackSafetyAction(companyId: string, id: string, patch: Partial<SafetyAction>) {
  const current = safetyActions.get(companyId) ?? [];
  const index = current.findIndex((item) => String(item.id) === String(id));
  if (index === -1) return null;
  const updated = { ...current[index], ...patch, updated_at: nowIso() };
  current[index] = updated;
  safetyActions.set(companyId, current);
  return updated;
}

export function deleteFallbackSafetyAction(companyId: string, id: string) {
  const current = safetyActions.get(companyId) ?? [];
  const next = current.filter((item) => String(item.id) !== String(id));
  if (next.length === current.length) return false;
  safetyActions.set(companyId, next);
  return true;
}

export function listFallbackToolboxTalks(companyId: string) {
  return [...(toolboxTalks.get(companyId) ?? [])].sort((a, b) => b.occurred_on.localeCompare(a.occurred_on));
}

export function createFallbackToolboxTalk(input: Omit<ToolboxTalk, "id" | "created_at" | "updated_at" | "attendees_count">) {
  const talk: ToolboxTalk = {
    ...input,
    id: nextId(),
    attendees_count: input.attendee_employee_ids.length,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  const current = toolboxTalks.get(input.company_id) ?? [];
  toolboxTalks.set(input.company_id, [talk, ...current]);
  return talk;
}

export function updateFallbackToolboxTalk(companyId: string, id: string, patch: Partial<ToolboxTalk>) {
  const current = toolboxTalks.get(companyId) ?? [];
  const index = current.findIndex((item) => String(item.id) === String(id));
  if (index === -1) return null;
  const updated = {
    ...current[index],
    ...patch,
    attendees_count: patch.attendee_employee_ids ? patch.attendee_employee_ids.length : current[index].attendees_count,
    updated_at: nowIso(),
  };
  current[index] = updated;
  toolboxTalks.set(companyId, current);
  return updated;
}

export function deleteFallbackToolboxTalk(companyId: string, id: string) {
  const current = toolboxTalks.get(companyId) ?? [];
  const next = current.filter((item) => String(item.id) !== String(id));
  if (next.length === current.length) return false;
  toolboxTalks.set(companyId, next);
  return true;
}

export function getFallbackSafetyOpsSummary(companyId: string) {
  const actions = listFallbackSafetyActions(companyId);
  const today = new Date().toISOString().slice(0, 10);
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  weekStart.setHours(0, 0, 0, 0);

  return {
    openHazards: actions.filter((item) => item.status === "open" || item.status === "in_progress").length,
    overdueActions: actions.filter((item) => (item.status === "open" || item.status === "in_progress") && item.due_date && item.due_date < today).length,
    closedThisWeek: actions.filter((item) => item.status === "closed" && item.closed_at && item.closed_at >= weekStart.toISOString()).length,
  };
}
