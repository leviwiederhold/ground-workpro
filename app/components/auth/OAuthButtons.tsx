'use client';

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Props = {
  /** Extra query string (e.g. invite token) to preserve through the callback. */
  callbackQuery?: string;
  label?: string;
};

/**
 * Google / Apple sign-in buttons via Supabase OAuth.
 *
 * NOTE: rendered on WEB only. Native callers hide these (native deep-link
 * OAuth callback is not yet confirmed) and keep email/password.
 */
export default function OAuthButtons({ callbackQuery = "", label = "or continue with" }: Props) {
  const [loading, setLoading] = useState<"google" | "apple" | null>(null);
  const [error, setError] = useState("");

  async function start(provider: "google" | "apple") {
    setLoading(provider);
    setError("");
    try {
      const origin = window.location.origin;
      const redirectTo = `${origin}/auth/callback${callbackQuery ? `?${callbackQuery}` : ""}`;
      const { error: oauthError } = await supabaseBrowser().auth.signInWithOAuth({
        provider,
        options: { redirectTo },
      });
      if (oauthError) {
        setError(oauthError.message);
        setLoading(null);
      }
      // On success the browser is redirected to the provider; nothing else to do.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to start sign-in");
      setLoading(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-gray-200" />
        <span className="text-xs uppercase tracking-wide text-gray-400">{label}</span>
        <div className="h-px flex-1 bg-gray-200" />
      </div>

      <button
        type="button"
        onClick={() => start("google")}
        disabled={loading !== null}
        className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
          <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.46 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z" />
        </svg>
        {loading === "google" ? "Redirecting…" : "Continue with Google"}
      </button>

      <button
        type="button"
        onClick={() => start("apple")}
        disabled={loading !== null}
        className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-900 bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-black disabled:opacity-60"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M16.36 12.78c.02 2.42 2.12 3.23 2.14 3.24-.02.06-.34 1.16-1.11 2.3-.67.99-1.36 1.97-2.45 1.99-1.07.02-1.41-.63-2.63-.63-1.22 0-1.6.61-2.61.65-1.05.04-1.85-1.07-2.52-2.05-1.38-2-2.43-5.65-1.02-8.11.7-1.22 1.95-2 3.31-2.02 1.03-.02 2.01.7 2.64.7.63 0 1.82-.86 3.07-.74.52.02 1.99.21 2.93 1.59-.08.05-1.75 1.02-1.73 3.08M14.4 4.9c.56-.68.94-1.62.84-2.56-.81.03-1.79.54-2.37 1.22-.52.6-.98 1.56-.86 2.48.9.07 1.83-.46 2.39-1.14" />
        </svg>
        {loading === "apple" ? "Redirecting…" : "Continue with Apple"}
      </button>

      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
    </div>
  );
}
