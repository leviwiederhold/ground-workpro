'use client';

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { isMobileWebBrowser } from "@/lib/runtime/isNativeApp";

const DISMISS_KEY = "groundwork_app_download_prompt_dismissed_at";
const DISMISS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Pages where the prompt must never appear.
const HIDDEN_PREFIXES = [
  "/login",
  "/signup",
  "/auth/callback",
  "/forgot-password",
  "/reset-password",
  "/settings/billing/success",
  "/pricing",
];

function recentlyDismissed(): boolean {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < DISMISS_WINDOW_MS;
  } catch {
    return false;
  }
}

export default function MobileAppDownloadPrompt() {
  const pathname = usePathname() || "/";
  const [visible, setVisible] = useState(false);

  const appStoreUrl = process.env.NEXT_PUBLIC_IOS_APP_STORE_URL?.trim() || "";

  useEffect(() => {
    // Fallback: no configured App Store URL → never render.
    if (!appStoreUrl) return;
    // Route guard.
    if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return;
    // Mobile web only (not native, not desktop).
    if (!isMobileWebBrowser()) return;
    // Respect a recent dismissal.
    if (recentlyDismissed()) return;

    setVisible(true);
  }, [pathname, appStoreUrl]);

  if (!visible) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // ignore storage errors
    }
    setVisible(false);
  };

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[60] p-3"
      style={{ paddingBottom: "max(0.75rem, var(--safe-area-bottom))" }}
      role="dialog"
      aria-label="Download the Groundwork Pro app"
    >
      <div className="mx-auto max-w-md rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl shadow-black/15 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
            <i className="fa-solid fa-mobile-screen-button" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
              Use Groundwork Pro on your phone
            </p>
            <p className="mt-1 text-xs leading-5 text-gray-600 dark:text-zinc-400">
              Download the app for faster access in the field. New company setup is completed on the website.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <a
                href={appStoreUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={dismiss}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-600 active:bg-brand-700"
              >
                <i className="fa-brands fa-apple" aria-hidden="true" />
                Download on the App Store
              </a>
              <button
                type="button"
                onClick={dismiss}
                className="rounded-lg px-3 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                Not now
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="-mr-1 -mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-zinc-800"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
