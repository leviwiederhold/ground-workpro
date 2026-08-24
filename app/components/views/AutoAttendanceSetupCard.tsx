"use client";

// CEO summary for the single authoritative setup-health contract. The parent
// warning panel consumes this same `items` array, so configured counts and
// actionable problems can never be derived from different employee populations.

import type { EmployeeSetupHealth } from "@/lib/attendance/setupHealth";

export function AutoAttendanceSetupCard({
  items,
}: {
  items: EmployeeSetupHealth[] | null;
}) {
  if (items === null || items.length === 0) return null;
  const configuredCount = items.filter((item) => item.configured).length;

  // Actionable failures are rendered by the warning panel. When everything is
  // working, keep setup as a small reassuring status instead of a large card.
  if (configuredCount === items.length) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-900/50 dark:bg-emerald-950/20">
        <span className="inline-flex items-center gap-2 text-sm font-medium text-emerald-800 dark:text-emerald-200">
          <i className="fa-solid fa-circle-check" />
          Automatic attendance active
        </span>
        <span className="shrink-0 text-xs text-emerald-700 dark:text-emerald-300">
          {configuredCount}/{items.length} active
        </span>
      </div>
    );
  }

  return null;
}
