"use client";

// NATIVE "log into an existing account" step.
//
// This is the original onboarding `employer-auth` screen, kept at its own route:
// same dark styling, same back button, same "Log in / Join invite" tabs, same
// heading and subcopy. The only addition is the three provider options.
//
// It is NOT the first screen the app shows. The app starts at /native (the
// onboarding slides); the user reaches this only by choosing to sign in.
//
// The provider buttons render unconditionally because this is the native login
// route — no runtime gating decides whether they exist. Runtime detection is
// used only to avoid invoking native plugins inside a normal browser.

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { NATIVE_ONBOARDING_CSS } from "@/app/components/native/onboardingStyles";
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
import { useNativeLoginDiagnostics } from "@/app/components/debug/useNativeLoginDiagnostics";

function BackArrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}

/**
 * Escape hatch for someone who reaches this route in a normal browser. The
 * native UI still renders (this is the native route) — this just offers the way
 * back to the website's sign-in.
 */
function BrowserFallbackNotice() {
  const [isBrowser, setIsBrowser] = useState(false);

  useEffect(() => {
    setIsBrowser(!detectNativeLoginRuntime());
  }, []);

  if (!isBrowser) return null;

  return (
    <div className="footer-hint" style={{ marginTop: 18 }}>
      This screen is for the Groundwork Pro app.{" "}
      <a href={WEB_LOGIN_ROUTE} style={{ color: "#f97316", fontWeight: 600 }}>
        Go to the website sign-in
      </a>
    </div>
  );
}

function NativeNoWorkspaceScreen() {
  return (
    <div className="gw-onboarding">
      <style jsx global>{NATIVE_ONBOARDING_CSS}</style>
      <div className="phone-frame">
        <div className="screen">
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div className="invite-title">No workspace yet</div>
            <div className="invite-desc">
              Your account isn&apos;t linked to a company yet. Ask your company administrator for an invitation.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function NativeLoginPage() {
  const router = useRouter();

  // Console-only; renders nothing.
  useNativeLoginDiagnostics();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [providerLoading, setProviderLoading] = useState<NativeProvider | null>(null);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [showNoWorkspace, setShowNoWorkspace] = useState(false);

  useEffect(() => {
    document.body.classList.add("native-onboarding-open");
    return () => document.body.classList.remove("native-onboarding-open");
  }, []);

  // Capture invite state arriving on this route so it survives a provider sheet.
  useEffect(() => {
    const pending = readPendingInviteFromSearch(window.location.search);
    if (pending) writePendingInviteState(pending, window.sessionStorage);
  }, []);

  // Already signed in? Straight to the app — never trapped on login.
  useEffect(() => {
    let active = true;
    supabaseBrowser()
      .auth.getSession()
      .then(({ data }) => {
        if (!active || !data.session) return;
        void routeAfterAuth();
      })
      .catch(() => {});
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function routeAfterAuth() {
    const destination = await resolveNativePostAuthDestination({
      search: window.location.search,
      storage: window.sessionStorage,
    });

    if (destination === "no-workspace") {
      setShowNoWorkspace(true);
      return;
    }

    router.replace("/");
    router.refresh();
  }

  async function onProviderSignIn(provider: NativeProvider) {
    setError("");

    // Never invoke native plugins in a normal browser. The buttons still render
    // (this is the native route) — they just explain themselves.
    if (!detectNativeLoginRuntime()) {
      setError("Native sign-in is only available in the Groundwork Pro app.");
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

  async function submitEmailAuth(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const supabase = supabaseBrowser();
      const result = await supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw new Error(result.error.message);
      await supabase.auth.getSession();

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
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  if (showNoWorkspace) return <NativeNoWorkspaceScreen />;

  const busy = providerLoading !== null || loading;

  return (
    <div className="gw-onboarding">
      <style jsx global>{NATIVE_ONBOARDING_CSS}</style>
      <style jsx global>{`
        .gw-onboarding .provider-btn {
          width: 100%;
          padding: 15px;
          border-radius: 14px;
          font-size: 15px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          margin-bottom: 12px;
          transition: transform 0.1s, opacity 0.2s;
        }
        .gw-onboarding .provider-btn:active { transform: scale(0.98); }
        .gw-onboarding .provider-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .gw-onboarding .provider-btn.apple { background: #fff; color: #000; border: none; }
        .gw-onboarding .provider-btn.google { background: #151515; color: #e5e5e5; border: 1px solid #222; }
        .gw-onboarding .provider-btn.email { background: transparent; color: #aaa; border: 1px solid #222; }
      `}</style>

      <div className="phone-frame">
        <div className="screen">
          <button className="back-btn" onClick={() => router.push("/native")} data-testid="native-login-back">
            <BackArrow />
            Back
          </button>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ textAlign: "center", marginBottom: 32 }}>
              <div className="logo-icon" style={{ margin: "0 auto 14px" }}>
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
                  <path d="M12 3L2 12h3v8h14v-8h3L12 3z" fill="white" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="auth-title" style={{ fontSize: 20, marginBottom: 4 }}>
                Sign in to Groundwork Pro
              </div>
              <div style={{ fontSize: 13, color: "#666" }}>Use your existing employee or company account.</div>
            </div>

            <div className="nav-tabs">
              <button className="nav-tab active" type="button">
                Log in
              </button>
              <button
                className="nav-tab"
                type="button"
                onClick={() => router.push("/native?screen=employee-invite")}
                data-testid="native-login-join-invite"
              >
                Join invite
              </button>
            </div>

            {/* Provider options — rendered unconditionally on the native route. */}
            <div data-testid="native-provider-buttons">
              <button
                type="button"
                className="provider-btn apple"
                onClick={() => onProviderSignIn("apple")}
                disabled={busy}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M16.36 12.78c.02 2.42 2.12 3.23 2.14 3.24-.02.06-.34 1.16-1.11 2.3-.67.99-1.36 1.97-2.45 1.99-1.07.02-1.41-.63-2.63-.63-1.22 0-1.6.61-2.61.65-1.05.04-1.85-1.07-2.52-2.05-1.38-2-2.43-5.65-1.02-8.11.7-1.22 1.95-2 3.31-2.02 1.03-.02 2.01.7 2.64.7.63 0 1.82-.86 3.07-.74.52.02 1.99.21 2.93 1.59-.08.05-1.75 1.02-1.73 3.08M14.4 4.9c.56-.68.94-1.62.84-2.56-.81.03-1.79.54-2.37 1.22-.52.6-.98 1.56-.86 2.48.9.07 1.83-.46 2.39-1.14" />
                </svg>
                {providerLoading === "apple" ? "Signing in..." : "Continue with Apple"}
              </button>

              <button
                type="button"
                className="provider-btn google"
                onClick={() => onProviderSignIn("google")}
                disabled={busy}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
                  <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.46 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z" />
                </svg>
                {providerLoading === "google" ? "Signing in..." : "Continue with Google"}
              </button>

              {!showEmailForm ? (
                <button
                  type="button"
                  className="provider-btn email"
                  onClick={() => setShowEmailForm(true)}
                  disabled={providerLoading !== null}
                  data-testid="native-continue-with-email"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <path d="M22 7l-10 7L2 7" />
                  </svg>
                  Continue with Email
                </button>
              ) : null}
            </div>

            {showEmailForm ? (
              <form onSubmit={submitEmailAuth} style={{ marginTop: 8 }} data-testid="native-email-form">
                <label className="form-label">Email</label>
                <input
                  className="form-input"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  data-testid="onboarding-login-email"
                />
                <label className="form-label">Password</label>
                <input
                  className="form-input"
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  data-testid="onboarding-login-password"
                />
                <button
                  className="primary-btn"
                  style={{ marginTop: 4 }}
                  disabled={busy}
                  data-testid="onboarding-auth-submit"
                >
                  {loading ? "Please wait..." : "Sign in"}
                </button>
              </form>
            ) : null}

            {error ? (
              <div className="form-error" role="alert" data-testid="native-login-error">
                {error}
              </div>
            ) : null}

            <BrowserFallbackNotice />
          </div>
        </div>
      </div>
    </div>
  );
}
