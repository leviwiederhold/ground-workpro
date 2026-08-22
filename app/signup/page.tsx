'use client';

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { isNativeAppRuntime } from "@/lib/runtime/isNativeApp";
import OAuthButtons from "@/app/components/auth/OAuthButtons";
import PasswordChecklist from "@/app/components/auth/PasswordChecklist";
import { isStrongPassword, STRONG_PASSWORD_MESSAGE } from "@/lib/auth/passwordPolicy";

const ROLE_LABELS: Record<string, string> = {
  ceo: "CEO",
  admin: "CEO",
  manager: "Operations Manager",
  pm: "Operations Manager",
  foreman: "Foreman",
  mechanic: "Mechanic",
  operator: "Operator",
  fieldstaff: "Field Staff",
};

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nativeRuntime, setNativeRuntime] = useState(false);
  const [inviteMode, setInviteMode] = useState(false);
  const [joinMode, setJoinMode] = useState(false);
  const [inviteInfo, setInviteInfo] = useState<{ companyName: string; role: string; jobTitle: string } | null>(null);
  const [joinInfo, setJoinInfo] = useState<{ companyName: string; expiresAt: string } | null>(null);
  const [inviteBlock, setInviteBlock] = useState<{ title: string; message: string } | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [trialMode, setTrialMode] = useState(false);
  const [checkoutSuccess, setCheckoutSuccess] = useState(false);
  const [loginHref, setLoginHref] = useState("/login");

  useEffect(() => {
    let active = true;
    const supabase = supabaseBrowser();
    const params = new URLSearchParams(window.location.search);
    setLoginHref(window.location.search ? `/login${window.location.search}` : "/login");
    setNativeRuntime(isNativeAppRuntime());
    const hasInvite = params.get("invite") === "1";
    const hasJoinCode = params.get("join") === "1" && Boolean(params.get("code"));
    setInviteMode(hasInvite);
    setJoinMode(hasJoinCode);
    const inviteTokenForInfo = params.get("token") || "";
    if (hasInvite && inviteTokenForInfo) {
      // Show the employee what workspace / role / title they are joining.
      fetch("/api/invite/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: inviteTokenForInfo }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!active) return;
          if (!data?.item) {
            setInviteBlock({
              title: "Invite link unavailable",
              message: "This invite link is invalid, expired, or has already been used. Ask your company administrator for a new invitation.",
            });
            return;
          }
          setInviteInfo({
            companyName: String(data.item.company_name ?? "").trim(),
            role: String(data.item.role ?? "").trim(),
            jobTitle: String(data.item.job_title ?? "").trim(),
          });
          // Block accepting in the inviter's own session: an owner/admin (or any
          // existing member) must use a different browser or sign out so the
          // invitee gets their own account — never the owner's.
          if (data.item.viewer_is_owner) {
            setInviteBlock({
              title: "You're signed in as the company owner",
              message:
                "You're signed in as the company owner. Open this invite in a different browser or sign out to accept as a new employee.",
            });
          } else if (data.item.viewer_is_member) {
            setInviteBlock({
              title: "You're already a member",
              message:
                "You're already a member of this company. Open this invite in a different browser, or sign out and accept with the invited employee's own account.",
            });
          }
        })
        .catch(() => {
          if (!active) return;
          setInviteBlock({
            title: "Invite link unavailable",
            message: "We couldn't validate this invite link. Ask your company administrator for a new invitation.",
          });
        });
    }
    const employeeJoinCode = params.get("code") || "";
    if (hasJoinCode) {
      fetch("/api/join/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: employeeJoinCode }),
      })
        .then(async (res) => ({ ok: res.ok, payload: await res.json().catch(() => ({})) }))
        .then(({ ok, payload }) => {
          if (!active) return;
          if (!ok || !payload?.item?.valid) {
            setInviteBlock({
              title: "Company code unavailable",
              message: payload?.error || "This company code is invalid or expired. Ask your company owner for a new code.",
            });
            return;
          }
          setJoinInfo({
            companyName: String(payload.item.company_name ?? "").trim(),
            expiresAt: String(payload.item.expires_at ?? ""),
          });
        })
        .catch(() => {
          if (!active) return;
          setInviteBlock({
            title: "Company code unavailable",
            message: "We couldn't validate this company code. Ask your company owner for a new code.",
          });
        });
    }
    const hasCheckoutSuccess = params.get("checkout") === "success";
    setCheckoutSuccess(hasCheckoutSuccess);
    const shouldStartTrial = !hasInvite && !hasJoinCode && !hasCheckoutSuccess;
    setTrialMode(shouldStartTrial);

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (!data.session) {
        if (hasCheckoutSuccess) {
          const sessionId = params.get("session_id");
          router.replace(`/settings/billing/success${sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ""}`);
        }
        return;
      }
      if (hasCheckoutSuccess) {
        const sessionId = params.get("session_id");
        router.replace(`/settings/billing/success${sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ""}`);
        router.refresh();
        return;
      }
      if (hasInvite) {
        // A signed-in user opened an invite link. Never redirect to the dashboard
        // (that reuses this session as the "employee"). The validate check above
        // surfaces an owner/member block screen; otherwise the invitee can sign
        // out and accept with their own account.
        return;
      }
      if (hasJoinCode) {
        ensureTenantContext()
          .then(() => {
            if (!active) return;
            router.replace("/");
            router.refresh();
          })
          .catch((joinError) => {
            if (!active) return;
            setError(joinError instanceof Error ? joinError.message : "Failed to join company");
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
    // ensureTenantContext is a stable closure defined in this component; it is
    // intentionally not a dependency to avoid re-running the mount effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function ensureTenantContext() {
    const params = new URLSearchParams(window.location.search);
    const invite = params.get("invite") === "1";
    const inviteRole = params.get("role") || undefined;
    const inviteEmail = params.get("email") || undefined;
    const inviteEmployeeId = params.get("employeeId") || undefined;
    const inviteToken = params.get("token") || undefined;
    const join = params.get("join") === "1";
    const joinCode = params.get("code") || undefined;
    const stripeSessionId = params.get("session_id") || undefined;

    if (invite) {
      const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
      const accept = await fetch("/api/invite/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: inviteRole, email: inviteEmail, employeeId: inviteEmployeeId, token: inviteToken, full_name: fullName || undefined }),
      });
      if (!accept.ok) {
        const payload = await accept.json().catch(() => ({}));
        throw new Error(payload?.error || "Failed to accept invite");
      }
      return;
    }

    if (join && joinCode) {
      const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
      const accept = await fetch("/api/join/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: joinCode, full_name: fullName || undefined }),
      });
      if (!accept.ok) {
        const payload = await accept.json().catch(() => ({}));
        throw new Error(payload?.error || "Failed to join company");
      }
      return;
    }

    const bootstrap = await fetch("/api/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stripeSessionId }),
    });
    if (!bootstrap.ok) {
      // Never surface raw/internal bootstrap errors to the user.
      throw new Error("We couldn't finish creating your workspace. Please try again or contact support.");
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

  async function signUpWithServer() {
    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
    const response = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, full_name: fullName || undefined }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      item?: { existingAccount?: boolean; authError?: string | null; hasSession?: boolean; identityCount?: number };
      error?: string;
    };

    if (!response.ok) {
      throw new Error(payload.error || "Failed to create account");
    }

    return {
      existingAccount: Boolean(payload.item?.existingAccount),
      authError: payload.item?.authError ?? null,
      hasSession: Boolean(payload.item?.hasSession),
      identityCount: typeof payload.item?.identityCount === "number" ? payload.item.identityCount : 1,
    };
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);

    const supabase = supabaseBrowser();
    const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const inviteMode = params?.get("invite") === "1";
    const joinMode = params?.get("join") === "1" && Boolean(params?.get("code"));
    const checkoutComplete = params?.get("checkout") === "success";
    const ownerSignupRequiresCheckout = !inviteMode && !joinMode && !checkoutComplete;
    if (nativeRuntime && !inviteMode && !joinMode) {
      setError("Already part of a company? Sign in or contact your company administrator.");
      setLoading(false);
      return;
    }
    if (!isStrongPassword(password)) {
      setError(STRONG_PASSWORD_MESSAGE);
      setLoading(false);
      return;
    }
    // Invited employees must supply their own name (admin no longer enters it).
    if ((inviteMode || joinMode) && (!firstName.trim() || !lastName.trim())) {
      setError("Please enter your first and last name.");
      setLoading(false);
      return;
    }
    try {
      let signUpResult: { existingAccount: boolean; authError: string | null; hasSession: boolean; identityCount: number };
      try {
        signUpResult = await signUpWithServer();
      } catch (signUpError) {
        const message = signUpError instanceof Error ? signUpError.message : "Failed to create account";
        const normalized = message.toLowerCase();
        if (normalized.includes("already") || normalized.includes("exists") || normalized.includes("registered")) {
          if (inviteMode || joinMode) {
            const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
            if (!signInError) {
              await supabase.auth.getSession();
              await ensureTenantContext();
              router.replace("/");
              router.refresh();
              return;
            }
            setError("This email already has an account. Sign in with the existing password to join the company.");
            return;
          }
          if (ownerSignupRequiresCheckout) {
            const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
            if (!signInError) {
              await supabase.auth.getSession();
              await ensureTenantContext();
              await startStripeCheckout();
              return;
            }
          }
          if (checkoutComplete) {
            const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
            if (!signInError) {
              await supabase.auth.getSession();
              await ensureTenantContext();
              router.replace("/");
              router.refresh();
              return;
            }
          }
          setError("This email is already registered. Please log in.");
          return;
        }
        setError(message);
        return;
      }

      if (signUpResult.authError) {
        setError(signUpResult.authError);
        return;
      }

      if (signUpResult.existingAccount || signUpResult.identityCount === 0) {
        if (inviteMode || joinMode) {
          const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
          if (!signInError) {
            await supabase.auth.getSession();
            await ensureTenantContext();
            router.replace("/");
            router.refresh();
            return;
          }
          setError("This email already has an account. Sign in with the existing password to join the company.");
          return;
        }
        if (ownerSignupRequiresCheckout) {
          const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
          if (!signInError) {
            await supabase.auth.getSession();
            await ensureTenantContext();
            await startStripeCheckout();
            return;
          }
        }
        if (checkoutComplete) {
          const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
          if (!signInError) {
            await supabase.auth.getSession();
            await ensureTenantContext();
            router.replace("/");
            router.refresh();
            return;
          }
        }
        setError("This email is already registered. Please log in.");
        return;
      }

      if (signUpResult.hasSession) {
        // Server-side signup sets cookies but the browser Supabase client uses
        // localStorage. Explicitly sign in on the browser client so localStorage
        // is populated before we navigate away to Stripe — otherwise the session
        // is lost when Stripe redirects back and billing/success finds no session.
        const { error: browserSignInError } = await supabase.auth.signInWithPassword({ email, password });
        if (browserSignInError) {
          // Non-fatal fallback: getSession reads whatever is available (may work
          // via cookie sync on some platforms).
          await supabase.auth.getSession();
        }
        await ensureTenantContext();
        if (checkoutComplete && !inviteMode && !joinMode) {
          router.replace("/");
          router.refresh();
          return;
        }
        if (ownerSignupRequiresCheckout) {
          await startStripeCheckout();
          return;
        }
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

  if ((inviteMode || joinMode) && inviteBlock) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white border border-gray-200 rounded-xl shadow-sm p-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <i className="fa-solid fa-user-shield text-xl" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">{inviteBlock.title}</h1>
          <p className="text-sm text-gray-600 mb-6">{inviteBlock.message}</p>
          <button
            type="button"
            onClick={async () => {
              setSigningOut(true);
              try {
                await supabaseBrowser().auth.signOut();
              } catch {
                // ignore — fall through to reload so the invite can be retried
              }
              window.location.reload();
            }}
            disabled={signingOut}
            className="w-full rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
            data-testid="invite-signout"
          >
            {signingOut ? "Signing out…" : "Sign out and accept as employee"}
          </button>
          <a href={loginHref} className="mt-3 inline-block text-sm text-gray-500 hover:text-gray-700">
            Cancel
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <h1 className="text-2xl font-semibold text-gray-900 mb-1">
          {nativeRuntime && !inviteMode && !joinMode ? "Already part of a company?" : "Create your account"}
        </h1>
        <p className="text-sm text-gray-500 mb-6">
          {nativeRuntime && !inviteMode && !joinMode
            ? "Sign in with your company account. If you need access, contact your company administrator."
            : nativeRuntime
              ? joinMode
                ? "Create your employee account to join your company."
                : "Create your account from your company invitation."
              : checkoutSuccess
                ? "Your trial has started. Create your account to finish setup."
              : trialMode
                ? "Create your account first, then start your 7-day trial."
                : "Create your account to get started."}
        </p>

        {joinMode && joinInfo ? (
          <div className="mb-5 rounded-lg border border-brand-200 bg-brand-50 p-4 text-sm text-brand-900">
            <p className="font-medium">
              You&apos;re joining{joinInfo.companyName ? ` ${joinInfo.companyName}` : " the company"}
            </p>
            <p className="mt-1 text-brand-800">Employee · Mobile app access</p>
          </div>
        ) : inviteMode && inviteInfo ? (
          <div className="mb-5 rounded-lg border border-brand-200 bg-brand-50 p-4 text-sm text-brand-900">
            <p className="font-medium">
              You&apos;re joining{inviteInfo.companyName ? ` ${inviteInfo.companyName}` : " the workspace"}
            </p>
            <p className="mt-1 text-brand-800">
              {[ROLE_LABELS[inviteInfo.role] || inviteInfo.role, inviteInfo.jobTitle]
                .filter(Boolean)
                .join(" · ") || "Create your account to join the team."}
            </p>
          </div>
        ) : checkoutSuccess && !inviteMode && !joinMode && !nativeRuntime ? (
          <div className="mb-5 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
            Your trial is ready. Create your account to enter Groundwork Pro.
          </div>
        ) : trialMode && !inviteMode && !joinMode && !nativeRuntime ? (
          <div className="mb-5 rounded-lg border border-brand-200 bg-brand-50 p-4 text-sm text-brand-800">
            Create your Groundwork Pro account to start your free trial.
          </div>
        ) : null}

        {nativeRuntime ? (
          <div className="mb-6 grid grid-cols-2 gap-3">
            <Link
              href={loginHref}
              className="rounded-lg border border-gray-300 bg-white px-4 py-3 text-center text-sm font-medium text-gray-700 transition hover:border-gray-400 hover:bg-gray-50"
            >
              Log In
            </Link>
            <div className="rounded-lg border border-brand-500 bg-brand-500 px-4 py-3 text-center text-sm font-medium text-white">
              {joinMode ? "Join Company" : inviteMode ? "Join Invite" : "Company Access"}
            </div>
          </div>
        ) : null}

        {nativeRuntime && !inviteMode && !joinMode ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">Contact your company administrator</p>
            <p className="mt-1">New company signup is available on the Groundwork Pro website. The iOS app supports existing users and invited team members.</p>
          </div>
        ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          {(inviteMode || joinMode) && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">First name</label>
                <input
                  type="text"
                  autoComplete="given-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Last name</label>
                <input
                  type="text"
                  autoComplete="family-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                />
              </div>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
            <PasswordChecklist value={password} />
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
            {loading
              ? "Creating account..."
              : checkoutSuccess && !inviteMode && !joinMode
                ? "Create account and finish setup"
                : trialMode && !inviteMode && !joinMode
                  ? "Create account and start trial"
                  : "Create account"}
          </button>
        </form>
        )}

        {!nativeRuntime && (
          <div className="mt-5">
            <OAuthButtons />
          </div>
        )}

        <p className="text-sm text-gray-500 mt-5 text-center">
          Already registered?{" "}
          <Link
            href={loginHref}
            className="text-brand-600 hover:text-brand-700 font-medium"
          >
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}
