'use client';

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isStrongPassword, STRONG_PASSWORD_MESSAGE } from "@/lib/auth/passwordPolicy";
import PasswordChecklist from "@/app/components/auth/PasswordChecklist";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

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
      // The recovery link establishes a session. The API repeats policy
      // validation server-side before updating the authenticated user.
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload?.error || "Unable to update password.");
        return;
      }
      setDone(true);
      setTimeout(() => {
        router.replace("/");
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
        {done ? (
          <p className="text-sm text-emerald-700 mt-4">Password updated. Taking you to your workspace…</p>
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
