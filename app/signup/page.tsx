'use client';

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { isNativeAppRuntime } from "@/lib/runtime/isNativeApp";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nativeRuntime, setNativeRuntime] = useState(false);
  const [inviteMode, setInviteMode] = useState(false);

  useEffect(() => {
    let active = true;
    const supabase = supabaseBrowser();
    const params = new URLSearchParams(window.location.search);
    setNativeRuntime(isNativeAppRuntime());
    setInviteMode(params.get("invite") === "1");

    supabase.auth.getSession().then(({ data }) => {
      if (!active || !data.session) return;
      router.replace("/");
      router.refresh();
    });

    return () => {
      active = false;
    };
  }, [router]);

  async function ensureTenantContext() {
    const params = new URLSearchParams(window.location.search);
    const invite = params.get("invite") === "1";
    const inviteRole = params.get("role") || undefined;
    const inviteEmail = params.get("email") || undefined;
    const inviteEmployeeId = params.get("employeeId") || undefined;
    const inviteToken = params.get("token") || undefined;

    if (invite) {
      const accept = await fetch("/api/invite/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: inviteRole, email: inviteEmail, employeeId: inviteEmployeeId, token: inviteToken }),
      });
      if (!accept.ok) {
        const payload = await accept.json().catch(() => ({}));
        throw new Error(payload?.error || "Failed to accept invite");
      }
      return;
    }

    const bootstrap = await fetch("/api/bootstrap", { method: "POST" });
    if (!bootstrap.ok) {
      const payload = await bootstrap.json().catch(() => ({}));
      throw new Error(payload?.error || "Failed to initialize company");
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);

    const supabase = supabaseBrowser();
    const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const inviteMode = params?.get("invite") === "1";
    if (nativeRuntime && !inviteMode) {
      setError("Already part of a company? Sign in or contact your company administrator.");
      setLoading(false);
      return;
    }
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (signUpError) {
        const normalized = signUpError.message.toLowerCase();
        if (normalized.includes("already") || normalized.includes("exists") || normalized.includes("registered")) {
          if (inviteMode) {
            const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
            if (!signInError) {
              await supabase.auth.getSession();
              await ensureTenantContext();
              router.replace("/");
              router.refresh();
              return;
            }
            setError("This invite email already has an account. Sign in with the existing password to accept the invite.");
            return;
          }
          setError("This email is already registered. Please log in.");
          return;
        }
        setError(signUpError.message);
        return;
      }

      const identityCount = Array.isArray(data?.user?.identities) ? data.user.identities.length : 1;
      if (data?.user && identityCount === 0) {
        if (inviteMode) {
          const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
          if (!signInError) {
            await supabase.auth.getSession();
            await ensureTenantContext();
            router.replace("/");
            router.refresh();
            return;
          }
          setError("This invite email already has an account. Sign in with the existing password to accept the invite.");
          return;
        }
        setError("This email is already registered. Please log in.");
        return;
      }

      if (data?.session) {
        await supabase.auth.getSession();
        await ensureTenantContext();
        router.replace("/");
        router.refresh();
        return;
      }
      setNotice("Check your email to confirm your account, then log in.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create account");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <h1 className="text-2xl font-semibold text-gray-900 mb-1">
          {nativeRuntime && !inviteMode ? "Already part of a company?" : "Create your account"}
        </h1>
        <p className="text-sm text-gray-500 mb-6">
          {nativeRuntime && !inviteMode
            ? "Sign in with your company account. If you need access, contact your company administrator."
            : nativeRuntime
              ? "Create your account from your company invitation."
              : "Create your account to get started."}
        </p>

        {nativeRuntime ? (
          <div className="mb-6 grid grid-cols-2 gap-3">
            <Link
              href={typeof window !== "undefined" && window.location.search ? `/login${window.location.search}` : "/login"}
              className="rounded-lg border border-gray-300 bg-white px-4 py-3 text-center text-sm font-medium text-gray-700 transition hover:border-gray-400 hover:bg-gray-50"
            >
              Log In
            </Link>
            <div className="rounded-lg border border-brand-500 bg-brand-500 px-4 py-3 text-center text-sm font-medium text-white">
              {inviteMode ? "Join Invite" : "Company Access"}
            </div>
          </div>
        ) : null}

        {nativeRuntime && !inviteMode ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">Contact your company administrator</p>
            <p className="mt-1">New company signup is available on the Groundwork Pro website. The iOS app supports existing users and invited team members.</p>
          </div>
        ) : (
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
        )}

        <p className="text-sm text-gray-500 mt-5 text-center">
          Already registered?{" "}
          <Link
            href={typeof window !== "undefined" && window.location.search ? `/login${window.location.search}` : "/login"}
            className="text-brand-600 hover:text-brand-700 font-medium"
          >
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}
