import { logServer } from "@/lib/observability/serverLog";

type MetricLabels = Record<string, string | number | boolean | null | undefined>;

function normalizeLabels(labels?: MetricLabels) {
  if (!labels) return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(labels)) {
    if (value === null || value === undefined) continue;
    out[key] = value;
  }
  return out;
}

export function incrementMetric(
  name: string,
  labels?: MetricLabels,
  value = 1
) {
  logServer("info", "metric_counter", {
    metric: name,
    value,
    labels: normalizeLabels(labels),
  });
}

export function gaugeMetric(name: string, value: number, labels?: MetricLabels) {
  logServer("info", "metric_gauge", {
    metric: name,
    value,
    labels: normalizeLabels(labels),
  });
}
