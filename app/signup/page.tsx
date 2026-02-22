'use client';

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);

    const supabase = supabaseBrowser();
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (signUpError) {
        const normalized = signUpError.message.toLowerCase();
        if (normalized.includes("already") || normalized.includes("exists") || normalized.includes("registered")) {
          setError("This email is already registered. Please log in.");
          return;
        }
        setError(signUpError.message);
        return;
      }

      const identityCount = Array.isArray(data?.user?.identities) ? data.user.identities.length : 1;
      if (data?.user && identityCount === 0) {
        setError("This email is already registered. Please log in.");
        return;
      }

      if (data?.session) {
        await supabase.auth.getSession();
        router.replace("/");
        router.refresh();
        return;
      }

      setNotice("Check your email to confirm your account, then log in.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <h1 className="text-2xl font-semibold text-gray-900 mb-1">Start your free trial</h1>
        <p className="text-sm text-gray-500 mb-6">Create your account to get started.</p>

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

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
          </div>

          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
          {!error && notice && <p className="text-sm text-green-700" role="status">{notice}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand-500 hover:bg-brand-600 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Creating account..." : "Create account"}
          </button>
        </form>

        <p className="text-sm text-gray-500 mt-5 text-center">
          Already registered? <Link href="/login" className="text-brand-600 hover:text-brand-700 font-medium">Log in</Link>
        </p>
      </div>
    </main>
  );
}
