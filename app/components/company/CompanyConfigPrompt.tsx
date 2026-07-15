'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

type MissingField = { key: string; label: string };

// Focused "finish company setup" prompt for the CEO/owner. It targets ONLY the
// required company-config fields that are still missing (never the whole
// onboarding flow again). It self-gates on the admin-only company settings API:
// employees get a 403 and see nothing, so this is never shown to — or editable
// by — non-owners. It re-checks on window focus so it disappears right after
// the CEO saves in Settings, without a full page reload.
export function CompanyConfigPrompt() {
  const [missing, setMissing] = useState<MissingField[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/company/settings', { cache: 'no-store' });
      if (!res.ok) {
        // 403 (employee / not owner) or any error → show nothing.
        setMissing([]);
        return;
      }
      const body = await res.json().catch(() => null);
      const items = Array.isArray(body?.missingConfig) ? (body.missingConfig as MissingField[]) : [];
      setMissing(items);
    } catch {
      setMissing([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [load]);

  if (!loaded || missing.length === 0) return null;

  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/40 dark:bg-amber-950/20">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            Finish setting up Attendance
          </p>
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-300/90">
            Attendance can&apos;t track arrivals until you add:{' '}
            <span className="font-medium">{missing.map((m) => m.label).join(', ')}</span>.
          </p>
        </div>
        <Link
          href="/settings/company?focus=work-schedule"
          className="inline-flex shrink-0 items-center justify-center rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700"
        >
          Complete setup
        </Link>
      </div>
    </div>
  );
}
