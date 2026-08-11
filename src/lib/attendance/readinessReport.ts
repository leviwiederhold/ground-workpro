export type VersionedReadinessReport = {
  reportedAt: string | null;
};

function parsedTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Readiness is a versioned device report. A delayed request must never replace
 * a report captured later, even when the delayed request reaches the server
 * last.
 */
export function shouldAcceptReadinessReport(
  currentReportedAt: string | null | undefined,
  incomingReportedAt: string | null | undefined
): boolean {
  const incoming = parsedTimestamp(incomingReportedAt);
  if (incoming === null) return false;
  const current = parsedTimestamp(currentReportedAt);
  return current === null || incoming > current;
}

export function newestReadinessReport<T extends VersionedReadinessReport>(
  current: T | null,
  incoming: T
): T | null {
  return shouldAcceptReadinessReport(current?.reportedAt, incoming.reportedAt) ? incoming : current;
}
