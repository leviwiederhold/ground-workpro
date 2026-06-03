'use client';

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { isNativeAppRuntime } from "@/lib/runtime/isNativeApp";
import OAuthButtons from "@/app/components/auth/OAuthButtons";
import { openGroundworkWebsite } from "@/lib/runtime/openWebsite";

/**
 * Opens the Groundwork Pro public website in the device's default external
 * browser (apex domain with www fallback). In Capacitor, window.open(url,
 * '_system') bypasses the in-app WebView and launches Safari.
 */
function openExternalWebsite() {
  void openGroundworkWebsite();
}

/** Shown only in the native app when the signed-in user has no company workspace. */
function NativeNoWorkspaceScreen() {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-xl shadow-sm p-8 text-center">
        <div className="w-14 h-14 rounded-full bg-brand-50 flex items-center justify-center mx-auto mb-5">
          <i className="fa-solid fa-globe text-brand-500 text-2xl" />
        </div>
        <h1 className="text-xl font-semibold text-gray-900 mb-3">Continue on Web</h1>
        <p className="text-sm text-gray-600 mb-6 leading-relaxed">
          Company setup is completed on the Groundwork Pro website. Once your
          workspace is created, you can sign in here.
        </p>
        <button
          type="button"
          onClick={openExternalWebsite}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-600 active:bg-brand-700"
        >
          <i className="fa-solid fa-arrow-up-right-from-square text-xs" />
          Continue on Web
        </button>
      </div>
    </main>
  );
}

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
  const [showNoWorkspace, setShowNoWorkspace] = useState(false);
  // Preserve invite context (and any params) through the OAuth callback.
  const [oauthCallbackQuery, setOauthCallbackQuery] = useState("");

  /**
   * In native app mode, check if the user has an accepted workspace membership.
   * If not, show the "Continue on Web" screen instead of routing to the dashboard.
   */
  async function checkNativeWorkspace(): Promise<boolean> {
    try {
      const res = await fetch("/api/auth/has-workspace");
      if (res.status === 401) return false;
      // Server error (can't determine) — optimistically allow entry rather than
      // locking out an existing user on a transient failure.
      if (!res.ok) return true;
      const payload = await res.json().catch(() => ({}));
      return Boolean(payload?.hasWorkspace);
    } catch {
      // Network error — optimistically allow entry so the app isn't bricked.
      return true;
    }
  }

  useEffect(() => {
    let active = true;
    const supabase = supabaseBrowser();
    const params = new URLSearchParams(window.location.search);
    // Never carry checkout/session_id params into the signup link.
    const rawParams = new URLSearchParams(window.location.search);
    rawParams.delete("checkout");
    rawParams.delete("session_id");
    const filteredSearch = rawParams.toString();
    setSignupHref(filteredSearch ? `/signup?${filteredSearch}` : "/signup");
    setOauthCallbackQuery(filteredSearch);
    const shouldStartTrial = params.get("trial") === "1";
    const hasCheckoutSuccess = params.get("checkout") === "success";
    setTrialMode(shouldStartTrial);
    setCheckoutSuccess(hasCheckoutSuccess);
    const isNative = isNativeAppRuntime();
    setNativeRuntime(isNative);

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active || !data.session) return;

      // Native app: invite-first, then workspace gate.
      if (isNative) {
        // Invited employees may not have a membership row yet — accept the
        // invite BEFORE the workspace check so the gate never blocks them.
        if (params.get("invite") === "1") {
          try {
            await ensureTenantContext();
            if (!active) return;
            router.replace("/");
            router.refresh();
          } catch (inviteError) {
            if (!active) return;
            setError(inviteError instanceof Error ? inviteError.message : "Failed to accept invite");
          }
          return;
        }
        const hasWorkspace = await checkNativeWorkspace();
        if (!active) return;
        if (!hasWorkspace) {
          setShowNoWorkspace(true);
          return;
        }
        router.replace("/");
        router.refresh();
        return;
      }

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

      // Ensure session cookies are in place before any checks.
      await supabase.auth.getSession();

      // Native app: invite-first, then workspace gate.
      if (nativeRuntime) {
        const params = new URLSearchParams(window.location.search);
        // Invited employees may not have a membership row yet — accept the
        // invite BEFORE the workspace check so the gate never blocks them.
        if (params.get("invite") === "1") {
          await ensureTenantContext();
          router.replace("/");
          router.refresh();
          return;
        }
        const hasWorkspace = await checkNativeWorkspace();
        if (!hasWorkspace) {
          setShowNoWorkspace(true);
          return;
        }
        router.replace("/");
        router.refresh();
        return;
      }

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

  // Native app — no workspace found after authentication.
  if (showNoWorkspace) {
    return <NativeNoWorkspaceScreen />;
  }

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        {checkoutSuccess && !nativeRuntime && (
          <div className="flex items-center gap-2 mb-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2">
            <i className="fa-solid fa-circle-check text-green-600 text-sm" />
            <span className="text-sm font-medium text-green-800">Payment successful — workspace is ready</span>
          </div>
        )}
        <h1 className="text-2xl font-semibold text-gray-900 mb-1">
          {nativeRuntime ? "Welcome to Groundwork Pro" : checkoutSuccess ? "Sign in to continue" : "Login"}
        </h1>
        <p className="text-sm text-gray-500 mb-6">
          {nativeRuntime
            ? "Choose how you want to continue."
            : trialMode
              ? "Sign in to start your free trial."
              : checkoutSuccess
                ? "Your payment was successful! Sign in to enter your workspace."
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

        {!nativeRuntime && (
          <p className="mt-3 text-center text-sm">
            <Link href="/forgot-password" className="text-brand-600 hover:text-brand-700 font-medium">
              Forgot password?
            </Link>
          </p>
        )}

        {/* OAuth — web only. Native deep-link callback is not confirmed yet, so
            native keeps email/password only. */}
        {!nativeRuntime && (
          <div className="mt-5">
            <OAuthButtons callbackQuery={oauthCallbackQuery} />
          </div>
        )}

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
          <>
            <div className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
              <p className="font-medium text-gray-800">Already part of a company? Sign in</p>
              <p className="mt-1">Need access? Contact your company administrator for an invitation.</p>
            </div>
            <div className="mt-4 text-center">
              <p className="text-xs text-gray-400 mb-1">Need a company workspace?</p>
              <button
                type="button"
                onClick={openExternalWebsite}
                className="text-sm text-gray-500 hover:text-gray-700 active:text-gray-900"
              >
                Continue on Web →
              </button>
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}
