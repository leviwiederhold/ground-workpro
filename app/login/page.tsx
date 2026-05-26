'use client';

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { isNativeAppRuntime } from "@/lib/runtime/isNativeApp";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nativeRuntime, setNativeRuntime] = useState(false);
  const [trialMode, setTrialMode] = useState(false);
  const [checkoutSuccess, setCheckoutSuccess] = useState(false);
  const [signupHref, setSignupHref] = useState("/signup");

  useEffect(() => {
    let active = true;
    const supabase = supabaseBrowser();
    const params = new URLSearchParams(window.location.search);
    // Never carry checkout/session_id params into the signup link — a user arriving
    // at /login?checkout=success has already paid and should log in, not re-sign-up.
    const rawParams = new URLSearchParams(window.location.search);
    rawParams.delete("checkout");
    rawParams.delete("session_id");
    const filteredSearch = rawParams.toString();
    setSignupHref(filteredSearch ? `/signup?${filteredSearch}` : "/signup");
    const shouldStartTrial = params.get("trial") === "1";
    const hasCheckoutSuccess = params.get("checkout") === "success";
    setTrialMode(shouldStartTrial);
    setCheckoutSuccess(hasCheckoutSuccess);
    setNativeRuntime(isNativeAppRuntime());

    supabase.auth.getSession().then(({ data }) => {
      if (!active || !data.session) return;
      if (hasCheckoutSuccess) {
        ensureTenantContext()
          .then(() => {
            router.replace("/");
            router.refresh();
          })
          .catch((checkoutError) => {
            if (!active) return;
            setError(checkoutError instanceof Error ? checkoutError.message : "Unable to finish checkout setup");
          });
        return;
      }
      if (shouldStartTrial) {
        ensureTenantContext()
          .then(() => startStripeCheckout())
          .catch((checkoutError) => {
            if (!active) return;
            setError(checkoutError instanceof Error ? checkoutError.message : "Unable to start checkout");
          });
        return;
      }
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
    const stripeSessionId = params.get("session_id") || undefined;

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

    const bootstrap = await fetch("/api/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stripeSessionId }),
    });
    if (!bootstrap.ok) {
      const payload = await bootstrap.json().catch(() => ({}));
      throw new Error(payload?.error || "Failed to initialize company");
    }
  }

  async function startStripeCheckout() {
    const response = await fetch("/api/billing/checkout", { method: "POST" });
    const payload = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!response.ok || !payload.url) {
      throw new Error(payload.error || "Unable to start checkout");
    }
    window.location.href = payload.url;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = supabaseBrowser();
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError(signInError.message);
        return;
      }

      // Ensure session cookies are in place before redirecting.
      await supabase.auth.getSession();
      await ensureTenantContext();
      if (checkoutSuccess) {
        router.replace("/");
        router.refresh();
        return;
      }
      if (trialMode && !nativeRuntime) {
        await startStripeCheckout();
        return;
      }
      router.replace("/");
      router.refresh();
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : "Failed to sign in. Please try again.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <h1 className="text-2xl font-semibold text-gray-900 mb-1">
          {nativeRuntime ? "Welcome to Groundwork Pro" : "Login"}
        </h1>
        <p className="text-sm text-gray-500 mb-6">
          {nativeRuntime
            ? "Choose how you want to continue."
            : trialMode
              ? "Sign in to start or resume Stripe Checkout."
              : checkoutSuccess
                ? "Sign in to finish checkout and enter your dashboard."
              : "Sign in with your email and password."}
        </p>

        {nativeRuntime ? (
          <div className="mb-6 grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-dark-900 bg-dark-900 px-4 py-3 text-center text-sm font-medium text-white">
              Log In
            </div>
            <div className="rounded-lg border border-gray-300 bg-white px-4 py-3 text-center text-sm font-medium text-gray-700">
              Company Access
            </div>
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              data-testid="login-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              type="password"
              data-testid="login-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600" role="alert" data-testid="login-error">
              {error}
            </p>
          )}

          <button
            type="submit"
            data-testid="login-submit"
            disabled={loading}
            className="w-full bg-dark-900 hover:bg-dark-800 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        {nativeRuntime ? null : (
          <p className="text-sm text-gray-500 mt-5 text-center">
            Need an account?{" "}
            <Link
              href={signupHref}
              className="text-brand-600 hover:text-brand-700 font-medium"
            >
              Sign up
            </Link>
          </p>
        )}

        {nativeRuntime ? (
          <div className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
            <p className="font-medium text-gray-800">Already part of a company? Sign in</p>
            <p className="mt-1">Need access? Contact your company administrator for an invitation.</p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
