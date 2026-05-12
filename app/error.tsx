'use client';

import { useEffect } from 'react';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[startup] Unhandled app error', error);
  }, [error]);

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6 text-gray-900 dark:bg-[#050505] dark:text-gray-100">
      <div className="mx-auto flex min-h-[calc(100dvh-3rem)] max-w-md items-center justify-center">
        <div className="w-full rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <h1 className="text-lg font-semibold">We&apos;re getting things ready</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            The app hit an unexpected startup issue. Please retry.
          </p>
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={reset}
              className="rounded-lg bg-dark-900 px-4 py-2 text-sm font-medium text-white hover:bg-dark-800"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => window.location.assign('/login')}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Go to login
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
