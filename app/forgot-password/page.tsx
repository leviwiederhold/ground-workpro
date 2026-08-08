'use client';

import { FormEvent, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { recoveryRedirectUrl } from "@/lib/auth/passwordReset";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const redirectTo = recoveryRedirectUrl(window.location.origin);
      const { error: resetError } = await supabaseBrowser().auth.resetPasswordForEmail(email.trim(), {
        redirectTo,
      });
      if (resetError) {
        setError(resetError.message);
        return;
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send reset email.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <h1 className="text-2xl font-semibold text-gray-900 mb-1">Reset your password</h1>
        {sent ? (
          <>
            <p className="text-sm text-gray-600 mb-6">
              If an account exists for <span className="font-medium">{email}</span>, a reset link is on its way.
              Check your inbox and follow the link to set a new password.
            </p>
            <Link href="/login" className="text-sm font-medium text-brand-600 hover:text-brand-700">
              Back to login
            </Link>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-6">
              Enter your email and we&apos;ll send you a link to reset your password.
            </p>
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
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
                {loading ? "Sending…" : "Send reset link"}
              </button>
            </form>
            <p className="text-sm text-gray-500 mt-5 text-center">
              Remembered it?{" "}
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
