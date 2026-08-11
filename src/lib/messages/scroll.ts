export const MESSAGE_BOTTOM_THRESHOLD_PX = 96;

export type MessageScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

export function distanceFromMessageBottom(metrics: MessageScrollMetrics): number {
  return Math.max(0, metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop);
}

export function isNearMessageBottom(
  metrics: MessageScrollMetrics,
  threshold = MESSAGE_BOTTOM_THRESHOLD_PX
): boolean {
  return distanceFromMessageBottom(metrics) <= threshold;
}

export function scrollTopAfterHistoryPrepend(input: {
  previousScrollTop: number;
  previousScrollHeight: number;
  nextScrollHeight: number;
}): number {
  const addedHeight = Math.max(0, input.nextScrollHeight - input.previousScrollHeight);
  return Math.max(0, input.previousScrollTop + addedHeight);
}

export function countNewMessages<T extends { id?: unknown }>(
  previous: T[],
  next: T[]
): number {
  const previousIds = new Set(previous.map((item) => String(item.id ?? "")).filter(Boolean));
  return next.reduce((count, item) => {
    const id = String(item.id ?? "");
    return id && !previousIds.has(id) ? count + 1 : count;
  }, 0);
}
