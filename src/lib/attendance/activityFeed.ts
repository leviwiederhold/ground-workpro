export type AttendanceActivityCard = {
  id: string;
  employeeId: string | null;
  userId: string | null;
  jobId: string | null;
  workDate: string | null;
  clockInAt: string | null;
  clockOutAt: string | null;
};

export type AttendanceBusinessEvent = {
  key: string;
  card: AttendanceActivityCard;
  type: "arrival" | "departure";
  occurredAt: string;
};

const DEDUPE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Project timecards into owner-facing business events. Raw detection telemetry
 * stays in jobsite_timecard_events; this intentionally exposes only confirmed
 * arrival/departure boundaries and correlates near-identical sessions.
 */
export function buildAttendanceActivity(
  cards: AttendanceActivityCard[],
  workDate: string,
): AttendanceBusinessEvent[] {
  const candidates: AttendanceBusinessEvent[] = [];
  for (const card of cards) {
    if (card.workDate !== workDate) continue;
    if (card.clockInAt) {
      candidates.push({ key: `${card.id}-arrival`, card, type: "arrival", occurredAt: card.clockInAt });
    }
    if (card.clockOutAt) {
      candidates.push({ key: `${card.id}-departure`, card, type: "departure", occurredAt: card.clockOutAt });
    }
  }

  candidates.sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const kept: AttendanceBusinessEvent[] = [];
  for (const event of candidates) {
    const identity = String(event.card.userId || event.card.employeeId || "unknown");
    const duplicate = kept.some((prior) =>
      prior.type === event.type &&
      String(prior.card.userId || prior.card.employeeId || "unknown") === identity &&
      String(prior.card.jobId || "") === String(event.card.jobId || "") &&
      Math.abs(Date.parse(prior.occurredAt) - Date.parse(event.occurredAt)) <= DEDUPE_WINDOW_MS
    );
    if (!duplicate) kept.push(event);
  }
  return kept.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
}
