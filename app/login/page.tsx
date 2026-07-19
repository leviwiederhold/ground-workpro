'use client';

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { isNativeAppRuntime } from "@/lib/runtime/isNativeApp";
import { detectNativeLoginRuntime } from "@/lib/runtime/detectNativeLoginRuntime";
import OAuthButtons from "@/app/components/auth/OAuthButtons";
import { openGroundworkWebsite } from "@/lib/runtime/openWebsite";
// TEMPORARY DIAGNOSTIC — remove once native login is confirmed on device.
import NativeAuthDebugBadge from "@/app/components/debug/NativeAuthDebugBadge";
import {
  readPendingInviteFromSearch,
  readPendingInviteState,
  signInWithAppleNative,
  signInWithGoogleNative,
  writePendingInviteState,
  type NativeProvider,
} from "@/lib/auth/nativeOAuth";

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
  // Detected synchronously so the FIRST client render is already correct.
  // Starting at `false` and only setting it in an effect is what previously let
  // the native provider buttons disappear: if any signal was late or missing,
  // the page stayed stuck on the web layout. Rechecked after hydration below,
  // once the Capacitor bridge has definitely been injected.
  const [nativeRuntime, setNativeRuntime] = useState<boolean>(() => detectNativeLoginRuntime());
  const [trialMode, setTrialMode] = useState(false);
  const [checkoutSuccess, setCheckoutSuccess] = useState(false);
  const [signupHref, setSignupHref] = useState("/signup");
  const [showNoWorkspace, setShowNoWorkspace] = useState(false);
  const [nativeProviderLoading, setNativeProviderLoading] = useState<NativeProvider | null>(null);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [inviteCompanyName, setInviteCompanyName] = useState<string | null>(null);

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

  function getPendingInvite() {
    if (typeof window === "undefined") return null;
    return readPendingInviteFromSearch(window.location.search) ?? readPendingInviteState(window.sessionStorage);
  }

  async function routeAfterNativeAuth() {
    const pendingInvite = getPendingInvite();
    if (pendingInvite) {
      await ensureTenantContext();
      writePendingInviteState(null, window.sessionStorage);
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
    const shouldStartTrial = params.get("trial") === "1";
    const hasCheckoutSuccess = params.get("checkout") === "success";
    setTrialMode(shouldStartTrial);
    setCheckoutSuccess(hasCheckoutSuccess);
    // Recheck after hydration: the Capacitor bridge may not have been evaluated
    // when the lazy initializer ran. Never downgrade a positive detection to
    // false — a signal going quiet must not tear the native UI back down.
    const isNative = detectNativeLoginRuntime() || isNativeAppRuntime();
    if (isNative) setNativeRuntime(true);
    const pendingInvite = readPendingInviteFromSearch(window.location.search);
    if (isNative && pendingInvite) {
      writePendingInviteState(pendingInvite, window.sessionStorage);
      setInviteCompanyName(pendingInvite.companyName ?? null);
    } else if (isNative) {
      const storedInvite = readPendingInviteState(window.sessionStorage);
      setInviteCompanyName(storedInvite?.companyName ?? null);
    }

    supabase.auth.getSession().then(async ({ data }) => {
      if (hasCheckoutSuccess) {
        const sessionId = params.get("session_id");
        router.replace(`/settings/billing/success${sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ""}`);
        router.refresh();
        return;
      }

      if (!active || !data.session) return;

      // Native app: invite-first, then workspace gate.
      if (isNative) {
        // Invited employees may not have a membership row yet — accept the
        // invite BEFORE the workspace check so the gate never blocks them.
        if (params.get("invite") === "1" || readPendingInviteState(window.sessionStorage)) {
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
    // Keep this mount-time auth redirect effect scoped to the current URL/session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function ensureTenantContext() {
    const params = new URLSearchParams(window.location.search);
    const storedInvite = nativeRuntime && typeof window !== "undefined" ? readPendingInviteState(window.sessionStorage) : null;
    const invite = params.get("invite") === "1" || storedInvite?.invite === "1";
    const inviteRole = params.get("role") || storedInvite?.role || undefined;
    const inviteEmail = params.get("email") || storedInvite?.email || undefined;
    const inviteEmployeeId = params.get("employeeId") || storedInvite?.employeeId || undefined;
    const inviteToken = params.get("token") || storedInvite?.token || undefined;
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
      if (nativeRuntime && typeof window !== "undefined") {
        writePendingInviteState(null, window.sessionStorage);
      }
      return;
    }

    // /api/bootstrap is idempotent and self-healing, and the app shell re-runs
    // setup verification (which bootstraps on demand) after redirect. It must
    // therefore NEVER hang login: time it out and FAIL OPEN so a slow/stuck
    // bootstrap can't leave the user pinned on "Signing in…" forever. Genuine
    // gating (no workspace, needs setup) is handled by the shell's startup gates.
    if (process.env.NODE_ENV !== 'production') console.log(`[LOGIN] bootstrap start ${new Date().toISOString()}`);
    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 8000);
      try {
        const bootstrap = await fetch("/api/bootstrap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stripeSessionId }),
          signal: controller.signal,
        });
        if (process.env.NODE_ENV !== 'production') console.log(`[LOGIN] bootstrap finished ${new Date().toISOString()} ok=${bootstrap.ok} status=${bootstrap.status}`);
      } finally {
        window.clearTimeout(timeoutId);
      }
    } catch (bootstrapError) {
      // Timeout or network failure — proceed to the app; the shell will finish
      // setup/verification. Do not block or error the login on this.
      if (process.env.NODE_ENV !== 'production') console.warn(`[LOGIN] bootstrap failed/timed out ${new Date().toISOString()} — continuing`, bootstrapError);
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
    if (process.env.NODE_ENV !== 'production') console.log(`[LOGIN] submit ${new Date().toISOString()}`);
    setLoading(true);
    setError(null);

    const supabase = supabaseBrowser();
    try {
      if (process.env.NODE_ENV !== 'production') console.log(`[LOGIN] signIn start ${new Date().toISOString()}`);
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        if (process.env.NODE_ENV !== 'production') console.warn(`[LOGIN] signIn error ${new Date().toISOString()}`, signInError.message);
        setError(signInError.message);
        return;
      }
      if (process.env.NODE_ENV !== 'production') console.log(`[LOGIN] signIn success ${new Date().toISOString()}`);

      // Ensure session cookies are in place before any checks.
      await supabase.auth.getSession();

      // Native app: invite-first, then workspace gate.
      if (nativeRuntime) {
        const params = new URLSearchParams(window.location.search);
        const storedInvite = readPendingInviteState(window.sessionStorage);
        // Invited employees may not have a membership row yet — accept the
        // invite BEFORE the workspace check so the gate never blocks them.
        if (params.get("invite") === "1" || storedInvite) {
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
        // Post-checkout owners go to onboarding, not the dashboard.
        router.replace("/setup?trial=started");
        router.refresh();
        return;
      }
      if (trialMode && !nativeRuntime) {
        await startStripeCheckout();
        return;
      }
      if (process.env.NODE_ENV !== 'production') console.log(`[LOGIN] redirect dashboard ${new Date().toISOString()}`);
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

  async function onNativeProviderSignIn(provider: NativeProvider) {
    setNativeProviderLoading(provider);
    setError(null);

    try {
      if (typeof window !== "undefined") {
        writePendingInviteState(readPendingInviteFromSearch(window.location.search), window.sessionStorage);
      }
      const supabase = supabaseBrowser();
      const result =
        provider === "apple" ? await signInWithAppleNative(supabase) : await signInWithGoogleNative(supabase);

      if (result.status === "cancelled") return;
      if (result.status === "error") {
        setError(result.message);
        return;
      }

      await supabase.auth.getSession();
      await routeAfterNativeAuth();
    } catch (nativeError) {
      setError(nativeError instanceof Error ? nativeError.message : "Unable to sign in. Please try again.");
    } finally {
      setNativeProviderLoading(null);
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
        {/* TEMPORARY DIAGNOSTIC — non-production hosts only. Remove once
            native login is confirmed working on device. `nativeRuntime` is the
            exact condition that gates the native provider buttons below. */}
        <NativeAuthDebugBadge nativeRuntime={nativeRuntime} nativeAuthUiRendered={nativeRuntime} />
        <h1 className="text-2xl font-semibold text-gray-900 mb-1">
          {nativeRuntime && getPendingInvite()
            ? `Join ${inviteCompanyName || "your company"}`
            : nativeRuntime
              ? "Sign in to Groundwork Pro"
              : checkoutSuccess
                ? "Sign in to continue"
                : "Login"}
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

        {nativeRuntime ? (
          <div className="mb-5 space-y-3">
            <button
              type="button"
              onClick={() => onNativeProviderSignIn("apple")}
              disabled={nativeProviderLoading !== null || loading}
              className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-900 bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-black disabled:opacity-60"
            >
              <i className="fa-brands fa-apple text-lg" />
              {nativeProviderLoading === "apple" ? "Signing in..." : "Continue with Apple"}
            </button>
            <button
              type="button"
              onClick={() => onNativeProviderSignIn("google")}
              disabled={nativeProviderLoading !== null || loading}
              className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
            >
              <i className="fa-brands fa-google text-base text-brand-600" />
              {nativeProviderLoading === "google" ? "Signing in..." : "Continue with Google"}
            </button>
            {!showEmailForm ? (
              <button
                type="button"
                onClick={() => setShowEmailForm(true)}
                disabled={nativeProviderLoading !== null}
                className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
              >
                <i className="fa-solid fa-envelope text-sm text-gray-500" />
                Continue with Email
              </button>
            ) : null}
          </div>
        ) : null}

        {(!nativeRuntime || showEmailForm) && <form onSubmit={onSubmit} className="space-y-4">
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
        </form>}

        {!nativeRuntime && (
          <p className="mt-3 text-center text-sm">
            <Link href="/forgot-password" className="text-brand-600 hover:text-brand-700 font-medium">
              Forgot password?
            </Link>
          </p>
        )}

        {nativeRuntime && !showEmailForm && error ? (
          <p className="text-sm text-red-600" role="alert" data-testid="login-error">
            {error}
          </p>
        ) : null}

        {/* OAuth — web only. Native uses provider ID tokens, not redirect OAuth. */}
        {!nativeRuntime && (
          <div className="mt-5">
            <OAuthButtons />
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
