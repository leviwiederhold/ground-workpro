export type MessageHistoryMembership = {
  role?: string | null;
  message_history_cutoff_at?: string | null;
};

const FULL_HISTORY_ROLES = new Set([
  "owner",
  "coowner",
  "admin",
  "administrator",
  "ceo",
  "executive",
]);

export function hasFullCompanyMessageHistory(role: unknown): boolean {
  const normalized = String(role ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return FULL_HISTORY_ROLES.has(normalized);
}

/** Null cutoffs grandfather memberships that existed when the policy shipped. */
export function getMessageHistoryCutoff(membership: MessageHistoryMembership): string | null {
  if (hasFullCompanyMessageHistory(membership.role)) return null;
  const cutoff = String(membership.message_history_cutoff_at ?? "").trim();
  return cutoff || null;
}

export function canViewCompanyMessageAt(
  membership: MessageHistoryMembership,
  messageCreatedAt: string | null | undefined
): boolean {
  const cutoff = getMessageHistoryCutoff(membership);
  if (!cutoff) return true;
  if (!messageCreatedAt) return false;
  const cutoffTime = Date.parse(cutoff);
  const messageTime = Date.parse(messageCreatedAt);
  return Number.isFinite(cutoffTime) && Number.isFinite(messageTime) && messageTime >= cutoffTime;
}
