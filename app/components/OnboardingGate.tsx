'use client';

import { FormEvent, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { NATIVE_ONBOARDING_CSS } from "@/app/components/native/onboardingStyles";

type AuthPayload = {
  email: string;
  password: string;
  company?: string;
  name?: string;
};

type OnboardingScreen = "carousel" | "role" | "employer-auth" | "employee-invite" | "company-access";

type OnboardingGateProps = {
  onLogin: (payload: AuthPayload) => void;
  /**
   * Optional. When provided, "Sign In" hands off to a dedicated login route
   * instead of showing the built-in employer-auth screen. Used by /native so the
   * login step can offer Apple/Google alongside email.
   *
   * Omitted (the default) preserves the original in-place behaviour exactly, so
   * the existing root-route usage is unchanged.
   */
  onRequestLogin?: () => void;
  /** Optional starting screen, so other routes can deep-link back into a step. */
  initialScreen?: OnboardingScreen;
};

const features = [
  {
    icon: '<svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><rect x="6" y="7" width="5" height="4" rx="1"/><rect x="13" y="7" width="5" height="4" rx="1"/><rect x="6" y="13" width="5" height="4" rx="1"/><path d="M13 15h5"/><path d="M15.5 13v4"/></svg>',
    title: 'Your command center',
    desc: 'Jobs, fleet, crew, safety, and costs — all from one dashboard built for dirt work.',
    bg: 'linear-gradient(135deg, #f97316, #ea580c)',
  },
  {
    icon: '<svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17V8a2 2 0 0 1 2-2h9v11"/><path d="M14 10h3.5l3.5 4v3h-3"/><path d="M14 17H9"/><circle cx="6.5" cy="17" r="2"/><circle cx="18" cy="17" r="2"/><path d="M6 10h4"/></svg>',
    title: 'Fleet management',
    desc: 'Track every machine from yard to jobsite. Maintenance, assignments, and utilization in real time.',
    bg: 'linear-gradient(135deg, #f59e0b, #ea580c)',
  },
  {
    icon: '<svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></svg>',
    title: 'Smart scheduling',
    desc: 'Coordinate crews, equipment, and jobs with fewer conflicts and zero phone-tag.',
    bg: 'linear-gradient(135deg, #0ea5e9, #2563eb)',
  },
  {
    icon: '<svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/><path d="M8 10h.01M12 10h.01M16 10h.01"/></svg>',
    title: 'Team messaging',
    desc: 'Field-to-office communication that stays organized. Channels, DMs, and job threads.',
    bg: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
  },
  {
    icon: '<svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h2M8 17h2M14 13h2M14 17h2"/></svg>',
    title: 'Job costing',
    desc: 'Watch actuals vs. estimates in real time. Catch margin drift before it becomes a problem.',
    bg: 'linear-gradient(135deg, #10b981, #0d9488)',
  },
  {
    icon: '<svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>',
    title: 'Safety & compliance',
    desc: 'Toolbox talks, incident logs, and certifications with auditable workflows.',
    bg: 'linear-gradient(135deg, #f43f5e, #e11d48)',
  },
];

function normalizeCompanyCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6);
}

export function OnboardingGate({ onLogin, onRequestLogin, initialScreen }: OnboardingGateProps) {
  const [screen, setScreen] = useState<OnboardingScreen>(initialScreen ?? "carousel");
  const [slide, setSlide] = useState(0);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteValue, setInviteValue] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    document.body.classList.add("native-onboarding-open");
    return () => document.body.classList.remove("native-onboarding-open");
  }, []);

  const goTo = (next: typeof screen) => {
    setError("");
    setScreen(next);
  };

  const goToLogin = () => {
    // Hand off to the dedicated native login route when one is wired up;
    // otherwise fall back to the original in-place screen.
    if (onRequestLogin) {
      onRequestLogin();
      return;
    }
    goTo("employer-auth");
  };

  const nextSlide = () => {
    if (slide < features.length - 1) {
      setSlide((current) => current + 1);
    } else {
      goTo("role");
    }
  };

  const submitEmployerAuth = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    const supabase = supabaseBrowser();
    try {
      const result = await supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw new Error(result.error.message);
      await supabase.auth.getSession();
      onLogin({ email, password });
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  const continueWithInvite = async () => {
    const code = normalizeCompanyCode(inviteValue);
    if (code.length !== 6) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/join/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.item?.valid) {
        throw new Error(payload?.error || "Invalid company code");
      }
      window.location.href = `/signup?join=1&code=${encodeURIComponent(code)}`;
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : "Invalid company code");
    } finally {
      setLoading(false);
    }
  };

  const feature = features[slide];
  const isInviteReady = normalizeCompanyCode(inviteValue).length === 6;

  return (
    <div className="gw-onboarding">
      <style jsx global>{NATIVE_ONBOARDING_CSS}</style>
      <div className="phone-frame">
        <div className="phone-notch" />

        <div className="screen" hidden={screen !== "carousel"}>
          <button className="skip-btn" onClick={() => goTo("role")}>Skip</button>
          <div className="feature-area">
            <div style={{ animation: "fadeUp 0.3s ease-out" }}>
              <div className="feature-icon" style={{ background: feature.bg }} dangerouslySetInnerHTML={{ __html: feature.icon }} />
              <div className="feature-title">{feature.title}</div>
              <div className="feature-desc">{feature.desc}</div>
            </div>
          </div>
          <div className="dots">
            {features.map((_, index) => (
              <button key={index} className={`dot${index === slide ? " active" : ""}`} onClick={() => setSlide(index)} />
            ))}
          </div>
          <button className="primary-btn" onClick={nextSlide}>{slide === features.length - 1 ? "Get started" : "Next"}</button>
        </div>

        <div className="screen" hidden={screen !== "role"}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div className="logo-area">
              <div className="logo-icon">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M12 3L2 12h3v8h14v-8h3L12 3z" fill="white" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/></svg>
              </div>
              <div className="logo-text">GROUNDWORK<span>PRO</span></div>
            </div>
            <div className="subtitle">How are you using Groundwork Pro?</div>
            <div style={{ width: "100%" }}>
              <button className="role-card" onClick={() => goTo("company-access")}>
                <div className="role-icon employer"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 21V9h6v12"/><path d="M3 9h18"/></svg></div>
                <div><div className="role-title">Already part of a company?</div><div className="role-desc">Sign in with your company account. New company signup is available on the web.</div></div>
              </button>
              <button className="role-card employee" onClick={() => goTo("employee-invite")}>
                <div className="role-icon employee"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 2L3 7v5c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V7l-9-5z"/><path d="M12 11v4"/><circle cx="12" cy="8" r="1"/></svg></div>
                <div><div className="role-title">I&apos;m an employee</div><div className="role-desc">Join your company&apos;s workspace with the code from your employer.</div></div>
              </button>
              <button className="secondary-link" onClick={goToLogin} data-testid="onboarding-existing-login">
                Already have an account? Sign In
              </button>
            </div>
          </div>
          <div className="footer-hint">You can change your role later in settings.</div>
        </div>

        <div className="screen" hidden={screen !== "company-access"}>
          <button className="back-btn" onClick={() => goTo("role")}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>Back</button>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div className="logo-icon" style={{ margin: "0 auto 18px" }}><svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M12 3L2 12h3v8h14v-8h3L12 3z" fill="white" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/></svg></div>
            <div className="auth-title">Already part of a company?</div>
            <div className="invite-desc">Sign in with your existing company account. If your company uses Groundwork Pro and you do not have access, contact your company administrator.</div>
            <div style={{ width: "100%" }}>
              <button className="primary-btn" onClick={goToLogin}>Sign in</button>
              <button className="secondary-link" onClick={() => goTo("employee-invite")}>I have a company code</button>
            </div>
            <div className="info-box" style={{ width: "100%", marginTop: 24 }}>
              <div className="info-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg></div>
              <div><div className="info-title">Contact your company administrator</div><div className="info-desc">Company signup and subscription setup are handled on the Groundwork Pro website.</div></div>
            </div>
          </div>
        </div>

        <div className="screen" hidden={screen !== "employer-auth"}>
          <button className="back-btn" onClick={() => goTo("role")}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>Back</button>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ textAlign: "center", marginBottom: 32 }}>
              <div className="logo-icon" style={{ margin: "0 auto 14px" }}><svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M12 3L2 12h3v8h14v-8h3L12 3z" fill="white" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/></svg></div>
              <div className="auth-title" style={{ fontSize: 20, marginBottom: 4 }}>
                Sign in to Groundwork Pro
              </div>
              <div style={{ fontSize: 13, color: "#666" }}>
                Use your existing employee or company account.
              </div>
            </div>
            <div className="nav-tabs">
              <button className="nav-tab active" type="button">Log in</button>
              <button className="nav-tab" type="button" onClick={() => goTo("employee-invite")}>Join invite</button>
            </div>
            <form onSubmit={submitEmployerAuth}>
              <label className="form-label">Email</label>
              <input className="form-input" type="email" placeholder="you@company.com" value={email} onChange={(event) => setEmail(event.target.value)} required data-testid="onboarding-login-email" />
              <label className="form-label">Password</label>
              <input className="form-input" type="password" placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} required data-testid="onboarding-login-password" />
              <button className="primary-btn" style={{ marginTop: 4 }} disabled={loading} data-testid="onboarding-auth-submit">{loading ? "Please wait..." : "Sign in"}</button>
              {error && <div className="form-error">{error}</div>}
            </form>
          </div>
        </div>

        <div className="screen" hidden={screen !== "employee-invite"}>
          <button className="back-btn" onClick={() => goTo("role")}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>Back</button>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div className="invite-icon"><svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="1.8" strokeLinecap="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 7L2 7"/></svg></div>
            <div className="invite-title">Join your company</div>
            <div className="invite-desc">Enter the 6-character employee join code from your company owner.</div>
            <div style={{ width: "100%" }}>
              <label className="form-label">Company code</label>
              <input className="form-input blue" autoCapitalize="characters" autoComplete="one-time-code" maxLength={6} placeholder="ABC123" value={inviteValue} onChange={(event) => setInviteValue(normalizeCompanyCode(event.target.value))} data-testid="onboarding-company-code" />
              <button className={`primary-btn${isInviteReady ? "" : " btn-disabled"}`} style={{ background: "#0ea5e9" }} disabled={!isInviteReady || loading} onClick={continueWithInvite}>{loading ? "Checking code…" : "Join company"}</button>
              {error && <div className="form-error">{error}</div>}
            </div>
            <div className="divider"><div className="divider-line" /><div className="divider-text">or</div><div className="divider-line" /></div>
            <div className="info-box" style={{ width: "100%" }}>
              <div className="info-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg></div>
              <div><div className="info-title">Don&apos;t have a code?</div><div className="info-desc">Ask your company owner or co-owner to generate one under <strong style={{ color: "#aaa" }}>Team → Employee Join Code</strong>. Individual invite links continue to work when opened directly.</div></div>
            </div>
            <button className="secondary-link" onClick={goToLogin}>
              Already have an account? Sign In
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
