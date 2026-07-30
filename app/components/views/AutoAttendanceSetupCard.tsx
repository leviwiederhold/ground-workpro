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
  if (items === null) return null;
  const configuredCount = items.filter((item) => item.configured).length;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
          Automatic attendance setup
        </h3>
        <span className="text-xs text-gray-500 dark:text-zinc-400">
          {configuredCount}/{items.length} configured
        </span>
      </div>
      <ul className="mt-3 space-y-1">
        {items.map((employee) => (
          <li key={employee.employeeId} className="flex items-center justify-between text-sm">
            <span className="text-gray-700 dark:text-zinc-300">
              {employee.name || "Team member"}
            </span>
            <span
              className={`inline-flex items-center gap-1.5 text-xs ${
                employee.configured ? "text-emerald-600" : "text-gray-400"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  employee.configured ? "bg-emerald-500" : "bg-gray-300"
                }`}
              />
              {employee.configured ? "On" : "Not set up"}
            </span>
          </li>
        ))}
        {items.length === 0 && (
          <li className="text-xs text-gray-400">No employees with app access yet.</li>
        )}
      </ul>
    </div>
  );
}
