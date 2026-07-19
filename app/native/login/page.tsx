"use client";

// NATIVE login entry point.
//
// The iOS app loads this route directly (see AppDelegate.swift). The ROUTE is
// the authoritative native/web distinction — this page ALWAYS renders the native
// provider UI because it is the native route. There is no runtime detection
// gating whether the buttons exist, which is what previously made them vanish
// when the Capacitor bridge was late or an origin changed.
//
// Runtime detection survives only for two narrow jobs:
//   1. refusing to invoke native plugins inside a normal browser
//   2. preview-only diagnostics
//
// The web route (/login) is unchanged and keeps its existing behaviour.

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  signInWithAppleNative,
  signInWithGoogleNative,
  readPendingInviteFromSearch,
  writePendingInviteState,
  type NativeProvider,
} from "@/lib/auth/nativeOAuth";
import {
  ensureTenantContext,
  getPendingInvite,
  resolveNativePostAuthDestination,
  WEB_LOGIN_ROUTE,
} from "@/lib/auth/loginFlow";
import { detectNativeLoginRuntime } from "@/lib/runtime/detectNativeLoginRuntime";
import NativeLoginDiagnostics from "@/app/components/debug/NativeLoginDiagnostics";

function NativeNoWorkspaceScreen() {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-xl shadow-sm p-6 text-center">
        <i className="fa-solid fa-building-user text-3xl text-gray-400 mb-3" />
        <h1 className="text-xl font-semibold text-gray-900 mb-2">No workspace yet</h1>
        <p className="text-sm text-gray-500">
          Your account isn&apos;t linked to a company yet. Ask your company administrator for an invitation.
        </p>
      </div>
    </main>
  );
}

export default function NativeLoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [providerLoading, setProviderLoading] = useState<NativeProvider | null>(null);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [showNoWorkspace, setShowNoWorkspace] = useState(false);
  const [inviteCompanyName, setInviteCompanyName] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  // Session gate + invite capture. This does NOT decide whether the native UI
  // renders — only whether the user should already be past it.
  useEffect(() => {
    let active = true;

    const pendingInvite = readPendingInviteFromSearch(window.location.search);
    if (pendingInvite) {
      writePendingInviteState(pendingInvite, window.sessionStorage);
      setInviteCompanyName(pendingInvite.companyName ?? null);
    } else {
      setInviteCompanyName(getPendingInvite("", window.sessionStorage)?.companyName ?? null);
    }

    supabaseBrowser()
      .auth.getSession()
      .then(async ({ data }) => {
        if (!active) return;
        if (!data.session) {
          setCheckingSession(false);
          return;
        }
        // Already authenticated — go straight to the dashboard.
        await routeAfterAuth();
      })
      .catch(() => {
        if (active) setCheckingSession(false);
      });

    return () => {
      active = false;
    };
    // Runs once on mount; routeAfterAuth reads live state via closures it owns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function routeAfterAuth() {
    const destination = await resolveNativePostAuthDestination({
      search: window.location.search,
      storage: window.sessionStorage,
    });

    if (destination === "no-workspace") {
      setShowNoWorkspace(true);
      setCheckingSession(false);
      return;
    }

    router.replace("/");
    router.refresh();
  }

  async function onProviderSignIn(provider: NativeProvider) {
    setError(null);

    // Guard: never invoke native plugins in a normal browser. The buttons still
    // RENDER here (that is the point of a dedicated native route) — they just
    // explain themselves instead of throwing a plugin error.
    if (!detectNativeLoginRuntime()) {
      setError(
        "Native sign-in is only available in the Groundwork Pro iOS app. On the web, use the sign-in page instead.",
      );
      return;
    }

    setProviderLoading(provider);
    try {
      writePendingInviteState(readPendingInviteFromSearch(window.location.search), window.sessionStorage);

      const supabase = supabaseBrowser();
      const result =
        provider === "apple" ? await signInWithAppleNative(supabase) : await signInWithGoogleNative(supabase);

      if (result.status === "cancelled") return;
      if (result.status === "error") {
        setError(result.message);
        return;
      }

      await supabase.auth.getSession();
      await routeAfterAuth();
    } catch (nativeError) {
      setError(nativeError instanceof Error ? nativeError.message : "Unable to sign in. Please try again.");
    } finally {
      setProviderLoading(null);
    }
  }

  async function onEmailSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const supabase = supabaseBrowser();
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(signInError.message);
        return;
      }

      const pendingInvite = getPendingInvite(window.location.search, window.sessionStorage);
      if (pendingInvite) {
        await ensureTenantContext({
          search: window.location.search,
          storage: window.sessionStorage,
          clearStoredInviteOnAccept: true,
        });
        router.replace("/");
        router.refresh();
        return;
      }

      await routeAfterAuth();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to sign in. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (showNoWorkspace) return <NativeNoWorkspaceScreen />;

  const busy = providerLoading !== null || loading;

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <NativeLoginDiagnostics />

        <h1 className="text-2xl font-semibold text-gray-900 mb-1">
          {inviteCompanyName ? `Join ${inviteCompanyName}` : "Sign in to Groundwork Pro"}
        </h1>
        <p className="text-sm text-gray-500 mb-6">Choose how you want to continue.</p>

        {/* Rendered unconditionally: this is the native route. */}
        <div className="space-y-3" data-testid="native-provider-buttons">
          <button
            type="button"
            onClick={() => onProviderSignIn("apple")}
            disabled={busy}
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-900 bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-black disabled:opacity-60"
          >
            <i className="fa-brands fa-apple text-lg" />
            {providerLoading === "apple" ? "Signing in..." : "Continue with Apple"}
          </button>

          <button
            type="button"
            onClick={() => onProviderSignIn("google")}
            disabled={busy}
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
          >
            <i className="fa-brands fa-google text-base text-brand-600" />
            {providerLoading === "google" ? "Signing in..." : "Continue with Google"}
          </button>

          {!showEmailForm ? (
            <button
              type="button"
              onClick={() => setShowEmailForm(true)}
              disabled={providerLoading !== null}
              className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
            >
              <i className="fa-solid fa-envelope text-sm text-gray-500" />
              Continue with Email
            </button>
          ) : null}
        </div>

        {showEmailForm ? (
          <form onSubmit={onEmailSubmit} className="mt-5 space-y-4" data-testid="native-email-form">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="native-email">
                Email
              </label>
              <input
                id="native-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="native-password">
                Password
              </label>
              <input
                id="native-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-60"
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>
        ) : null}

        {error ? (
          <p className="mt-4 text-sm text-red-600" role="alert" data-testid="native-login-error">
            {error}
          </p>
        ) : null}

        {checkingSession ? null : (
          <p className="mt-5 text-center text-sm text-gray-500">
            Need access? Contact your company administrator for an invitation.
          </p>
        )}

        {/* Browser fallback: the native UI still renders, but a visitor who
            reached this route in a desktop/mobile browser gets a way out. */}
        <BrowserFallbackNotice />
      </div>
    </main>
  );
}

function BrowserFallbackNotice() {
  const [isBrowser, setIsBrowser] = useState(false);

  useEffect(() => {
    setIsBrowser(!detectNativeLoginRuntime());
  }, []);

  if (!isBrowser) return null;

  return (
    <p className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-center text-xs text-gray-500">
      This screen is for the Groundwork Pro iOS app.{" "}
      <Link href={WEB_LOGIN_ROUTE} className="font-medium text-brand-600 hover:text-brand-700">
        Go to the website sign-in
      </Link>
    </p>
  );
}
