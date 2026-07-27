"use client";

// Admin visibility: which employees have automatic attendance actually
// configured (background location ready). Reads the company-scoped permission
// map; the server derives `automaticAttendanceConfigured` from the separated
// permission dimensions, so this never over-claims when background is missing.

import { useEffect, useMemo, useState } from "react";

type PermissionItem = { userId: string; automaticAttendanceConfigured: boolean };

export function AutoAttendanceSetupCard({
  employees = [],
}: {
  employees?: Array<{ id: string; name?: string; user_id?: string | null }>;
}) {
  const [items, setItems] = useState<PermissionItem[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/attendance/location-permission?scope=company", { cache: "no-store" });
        if (res.status === 403) return; // not a manager — hide silently
        const json = await res.json().catch(() => null);
        if (!active) return;
        if (!res.ok) {
          setError(json?.error || "Failed to load setup status");
          return;
        }
        setItems(Array.isArray(json?.items) ? json.items : []);
      } catch {
        if (active) setError("Failed to load setup status");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const configuredByUser = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const it of items ?? []) m.set(String(it.userId), Boolean(it.automaticAttendanceConfigured));
    return m;
  }, [items]);

  if (items === null && !error) return null;

  const withUser = employees.filter((e) => e.user_id);
  const configuredCount = withUser.filter((e) => configuredByUser.get(String(e.user_id))).length;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Automatic attendance setup</h3>
        <span className="text-xs text-gray-500 dark:text-zinc-400">
          {configuredCount}/{withUser.length} configured
        </span>
      </div>
      {error ? (
        <p className="mt-2 text-xs text-red-600">{error}</p>
      ) : (
        <ul className="mt-3 space-y-1">
          {withUser.map((e) => {
            const configured = configuredByUser.get(String(e.user_id)) ?? false;
            return (
              <li key={e.id} className="flex items-center justify-between text-sm">
                <span className="text-gray-700 dark:text-zinc-300">{e.name || "Team member"}</span>
                <span className={`inline-flex items-center gap-1.5 text-xs ${configured ? "text-emerald-600" : "text-gray-400"}`}>
                  <span className={`h-2 w-2 rounded-full ${configured ? "bg-emerald-500" : "bg-gray-300"}`} />
                  {configured ? "On" : "Not set up"}
                </span>
              </li>
            );
          })}
          {withUser.length === 0 && <li className="text-xs text-gray-400">No employees with app access yet.</li>}
        </ul>
      )}
    </div>
  );
}
