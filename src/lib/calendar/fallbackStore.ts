import * as fs from "node:fs";
import * as path from "node:path";

type FallbackEvent = {
  id: string;
  company_id: string;
  title: string;
  description: string;
  location_text: string;
  starts_at: string;
  ends_at: string;
  event_type: string;
  visibility: "attendees" | "company" | "private";
  created_by: string;
  created_at: string;
  attendees: Array<{
    attendee_type: "user" | "employee" | "external";
    user_id: string | null;
    employee_id: string | null;
    external_name: string | null;
    external_contact: string | null;
    response_status: string;
  }>;
};

type FallbackStore = {
  events: FallbackEvent[];
};

const fallbackFilePath = path.join("/tmp", "groundwork-fallback-calendar.json");

function readStore(): FallbackStore {
  try {
    if (!fs.existsSync(fallbackFilePath)) return { events: [] };
    const raw = fs.readFileSync(fallbackFilePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { events: [] };
    return { events: Array.isArray(parsed.events) ? parsed.events : [] };
  } catch {
    return { events: [] };
  }
}

function writeStore(store: FallbackStore) {
  try {
    fs.writeFileSync(fallbackFilePath, JSON.stringify(store), "utf8");
  } catch {
    // no-op
  }
}

export function createFallbackEvent(input: Omit<FallbackEvent, "id" | "created_at">) {
  const store = readStore();
  const event: FallbackEvent = {
    ...input,
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
  };
  store.events.push(event);
  writeStore(store);
  return event;
}

export function listFallbackEventsForWeek(companyId: string, weekStart: string, weekEnd: string) {
  return readStore().events
    .filter((event) => {
      if (event.company_id !== companyId) return false;
      const starts = event.starts_at.slice(0, 10);
      return starts >= weekStart && starts <= weekEnd;
    })
    .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
}

export function getFallbackEventById(companyId: string, eventId: string) {
  return readStore().events.find(
    (event) => String(event.company_id) === String(companyId) && String(event.id) === String(eventId)
  ) ?? null;
}

export function updateFallbackEvent(
  companyId: string,
  eventId: string,
  updates: Partial<Pick<FallbackEvent, "title" | "description" | "location_text" | "starts_at" | "ends_at" | "event_type" | "visibility">>
) {
  const store = readStore();
  const index = store.events.findIndex(
    (event) => String(event.company_id) === String(companyId) && String(event.id) === String(eventId)
  );
  if (index < 0) return null;
  store.events[index] = { ...store.events[index], ...updates };
  writeStore(store);
  return store.events[index];
}

export function deleteFallbackEvent(companyId: string, eventId: string) {
  const store = readStore();
  const index = store.events.findIndex(
    (event) => String(event.company_id) === String(companyId) && String(event.id) === String(eventId)
  );
  if (index < 0) return false;
  store.events.splice(index, 1);
  writeStore(store);
  return true;
}

export function respondToFallbackEventInvite(
  companyId: string,
  eventId: string,
  userId: string,
  responseStatus: "accepted" | "declined"
) {
  const store = readStore();
  const index = store.events.findIndex(
    (event) => String(event.company_id) === String(companyId) && String(event.id) === String(eventId)
  );
  if (index < 0) return null;
  const event = store.events[index];
  let updated = false;
  event.attendees = event.attendees.map((attendee) => {
    if (attendee.attendee_type === "user" && String(attendee.user_id ?? "") === String(userId)) {
      updated = true;
      return { ...attendee, response_status: responseStatus };
    }
    return attendee;
  });
  if (!updated) return null;
  store.events[index] = event;
  writeStore(store);
  return event;
}
