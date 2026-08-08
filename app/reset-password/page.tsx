'use client';

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isStrongPassword, STRONG_PASSWORD_MESSAGE } from "@/lib/auth/passwordPolicy";
import PasswordChecklist from "@/app/components/auth/PasswordChecklist";
import { supabaseBrowser } from "@/lib/supabase/client";

type LinkState = "checking" | "valid" | "invalid";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [linkState, setLinkState] = useState<LinkState>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  // The callback restores the recovery session (via Set-Cookie) before landing
  // here. Confirm a session exists before showing the form; a missing session or
  // an `error` param from the callback means the link was expired, malformed, or
  // already used — show a clear recovery error instead of a dead form.
  useEffect(() => {
    let active = true;
    if (new URLSearchParams(window.location.search).get("error")) {
      setLinkState("invalid");
      return;
    }
    supabaseBrowser()
      .auth.getSession()
      .then(({ data }) => {
        if (!active) return;
        setLinkState(data.session ? "valid" : "invalid");
      })
      .catch(() => {
        if (active) setLinkState("invalid");
      });
    return () => {
      active = false;
    };
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    if (!isStrongPassword(password)) {
      setError(STRONG_PASSWORD_MESSAGE);
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      // The recovery link established a session. The API repeats policy
      // validation server-side before updating the authenticated user.
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401) {
          // Session lost/expired mid-flow — treat as an invalid link.
          setLinkState("invalid");
          return;
        }
        setError(payload?.error || "Unable to update password.");
        return;
      }
      setDone(true);
      // Sign the recovery session out so the user re-authenticates with the new
      // password, then send them back to login. Clearing the session also stops
      // the login page from bouncing an authenticated user to the dashboard.
      try {
        await fetch("/api/logout", { method: "POST" }).catch(() => {});
        await supabaseBrowser().auth.signOut();
      } catch {
        // Best-effort: even if sign-out fails, still route to login.
      }
      setTimeout(() => {
        router.replace("/login?reset=1");
        router.refresh();
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <h1 className="text-2xl font-semibold text-gray-900 mb-1">Set a new password</h1>

        {linkState === "checking" ? (
          <p className="text-sm text-gray-500 mt-4">Verifying your reset link…</p>
        ) : linkState === "invalid" ? (
          <>
            <p className="text-sm text-red-600 mt-4" role="alert">
              This reset link is invalid or has expired. Reset links can only be used once and
              expire after a short time.
            </p>
            <p className="text-sm text-gray-500 mt-5 text-center">
              <Link href="/forgot-password" className="text-brand-600 hover:text-brand-700 font-medium">
                Request a new reset link
              </Link>
            </p>
          </>
        ) : done ? (
          <p className="text-sm text-emerald-700 mt-4">
            Password updated. Taking you to sign in with your new password…
          </p>
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-6">Choose a strong password for your account.</p>
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                />
                <PasswordChecklist value={password} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Confirm password</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                />
              </div>
              {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-dark-900 hover:bg-dark-800 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50"
              >
                {loading ? "Updating…" : "Update password"}
              </button>
            </form>
            <p className="text-sm text-gray-500 mt-5 text-center">
              <Link href="/login" className="text-brand-600 hover:text-brand-700 font-medium">
                Back to login
              </Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
