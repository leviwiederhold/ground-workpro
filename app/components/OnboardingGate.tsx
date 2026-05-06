'use client';

import { FormEvent, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

const ONBOARDING_COMPLETE_KEY = "groundwork.nativeOnboardingComplete";

type AuthPayload = {
  email: string;
  password: string;
  company?: string;
  name?: string;
};

type OnboardingGateProps = {
  onLogin: (payload: AuthPayload) => void;
  onSignup: (payload: AuthPayload) => void;
};

const features = [
  {
    icon: '<svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><rect x="6" y="7" width="5" height="4" rx="1"/><rect x="13" y="7" width="5" height="4" rx="1"/><rect x="6" y="13" width="5" height="4" rx="1"/><path d="M13 15h5"/><path d="M15.5 13v4"/></svg>',
    title: 'Your command center',
    desc: 'Jobs, fleet, crew, safety, and costs — all from one dashboard built for dirt work.',
    bg: 'linear-gradient(135deg, #f97316, #ea580c)',
  },
  {
    icon: '<svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round"><rect x="2" y="13" width="7" height="7" rx="1.5"/><circle cx="5.5" cy="16.5" r="2"/><path d="M9 14h2"/><path d="M5.5 13V9.5a2.5 2.5 0 012.5-2.5h8a2.5 2.5 0 012.5 2.5V13"/><rect x="15" y="5" width="5" height="15" rx="1.5"/><path d="M17.5 8h0M17.5 11h0"/></svg>',
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

function extractInviteToken(value: string) {
  const input = value.trim();
  if (!input) return "";
  try {
    const url = new URL(input);
    return url.searchParams.get("token") || input;
  } catch {
    return input;
  }
}

export function isNativeOnboardingComplete() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(ONBOARDING_COMPLETE_KEY) === "1";
}

export function markNativeOnboardingComplete() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ONBOARDING_COMPLETE_KEY, "1");
}

export function OnboardingGate({ onLogin, onSignup }: OnboardingGateProps) {
  const [screen, setScreen] = useState<"carousel" | "role" | "employer-auth" | "employee-invite">("carousel");
  const [slide, setSlide] = useState(0);
  const [authMode, setAuthMode] = useState<"signup" | "login">("signup");
  const [company, setCompany] = useState("");
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
    if (next === "employer-auth" || next === "employee-invite") markNativeOnboardingComplete();
    setError("");
    setScreen(next);
  };

  const nextSlide = () => {
    if (slide < features.length - 1) {
      setSlide((current) => current + 1);
    } else {
      goTo("role");
    }
  };

  const bootstrapEmployer = async () => {
    const response = await fetch("/api/bootstrap", { method: "POST" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload?.error || "Failed to initialize company");
    }
  };

  const submitEmployerAuth = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    const supabase = supabaseBrowser();
    try {
      if (authMode === "login") {
        const result = await supabase.auth.signInWithPassword({ email, password });
        if (result.error) throw new Error(result.error.message);
        await supabase.auth.getSession();
        await bootstrapEmployer();
        onLogin({ email, password, company });
        return;
      }

      const result = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            company_name: company.trim() || undefined,
            company: company.trim() || undefined,
          },
        },
      });
      if (result.error) throw new Error(result.error.message);
      if (result.data?.session) {
        await supabase.auth.getSession();
        await bootstrapEmployer();
        onSignup({ email, password, company });
        return;
      }
      setError("Check your email to confirm your account, then log in.");
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  const continueWithInvite = async () => {
    const token = extractInviteToken(inviteValue);
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/invite/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.item?.valid) {
        throw new Error(payload?.error || "Invalid invite code");
      }
      markNativeOnboardingComplete();
      window.location.href = `/signup?invite=1&token=${encodeURIComponent(token)}`;
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : "Invalid invite code");
    } finally {
      setLoading(false);
    }
  };

  const feature = features[slide];
  const isInviteReady = inviteValue.trim().length > 0;

  return (
    <div className="gw-onboarding">
      <style jsx global>{`
        body.native-onboarding-open { overflow: hidden; background: #000; }
        .gw-onboarding * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .gw-onboarding { position: fixed; inset: 0; z-index: 9999; background: #000; color: #e5e5e5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; min-height: 100dvh; height: 100dvh; overflow: hidden; }
        .gw-onboarding .phone-frame { width: 100%; min-height: 100dvh; background: #0a0a0a; overflow: hidden; position: relative; color: #e5e5e5; }
        .gw-onboarding .phone-notch { display: none; }
        .gw-onboarding .screen { padding: max(env(safe-area-inset-top), 0px) 28px max(36px, env(safe-area-inset-bottom)); display: flex; flex-direction: column; min-height: 100dvh; height: 100dvh; animation: fadeUp 0.35s ease-out; overflow-y: auto; overscroll-behavior: contain; }
        .gw-onboarding .screen[hidden] { display: none !important; }
        .gw-onboarding .skip-btn { text-align: right; padding: 16px 0 0; font-size: 13px; color: #555; cursor: pointer; background: none; border: none; font-family: inherit; }
        .gw-onboarding .skip-btn:hover { color: #999; }
        .gw-onboarding .feature-area { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
        .gw-onboarding .feature-icon { width: 100px; height: 100px; border-radius: 28px; display: flex; align-items: center; justify-content: center; margin: 0 auto 28px; }
        .gw-onboarding .feature-icon svg { display: block; margin: 0 auto; }
        .gw-onboarding .feature-title { font-size: 24px; font-weight: 600; color: #f5f5f5; margin-bottom: 10px; }
        .gw-onboarding .feature-desc { font-size: 15px; color: #777; line-height: 1.6; max-width: 290px; margin: 0 auto; }
        .gw-onboarding .dots { display: flex; justify-content: center; gap: 8px; margin-bottom: 20px; }
        .gw-onboarding .dot { width: 8px; height: 8px; border-radius: 4px; background: #2a2a2a; border: none; cursor: pointer; transition: all 0.3s; padding: 0; }
        .gw-onboarding .dot.active { width: 24px; background: #f97316; }
        .gw-onboarding .primary-btn { width: 100%; padding: 16px; border-radius: 14px; background: #f97316; color: #fff; font-size: 15px; font-weight: 600; border: none; cursor: pointer; font-family: inherit; transition: transform 0.1s, background 0.2s; }
        .gw-onboarding .primary-btn:active { transform: scale(0.98); }
        .gw-onboarding .primary-btn:hover { background: #ea580c; }
        .gw-onboarding .logo-area { display: flex; flex-direction: column; align-items: center; margin-bottom: 12px; }
        .gw-onboarding .logo-icon { width: 60px; height: 60px; border-radius: 18px; background: #f97316; display: flex; align-items: center; justify-content: center; margin-bottom: 14px; }
        .gw-onboarding .logo-icon svg { display: block; margin: 0 auto; }
        .gw-onboarding .logo-text { font-size: 24px; font-weight: 700; letter-spacing: 0.08em; color: #f5f5f5; }
        .gw-onboarding .logo-text span { color: #f97316; }
        .gw-onboarding .subtitle { font-size: 14px; color: #555; margin-bottom: 40px; }
        .gw-onboarding .role-card { width: 100%; padding: 20px; border-radius: 18px; border: 2px solid #1e1e1e; background: #111; cursor: pointer; text-align: left; display: flex; gap: 16px; align-items: flex-start; margin-bottom: 14px; transition: border-color 0.2s, box-shadow 0.2s; font-family: inherit; }
        .gw-onboarding .role-card:hover { border-color: #f97316; box-shadow: 0 4px 20px rgba(249, 115, 22, 0.1); }
        .gw-onboarding .role-card.employee:hover { border-color: #0ea5e9; box-shadow: 0 4px 20px rgba(14, 165, 233, 0.1); }
        .gw-onboarding .role-icon { width: 48px; height: 48px; border-radius: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .gw-onboarding .role-icon svg { display: block; margin: 0 auto; }
        .gw-onboarding .role-icon.employer { background: #2a1a08; color: #f97316; }
        .gw-onboarding .role-icon.employee { background: #082338; color: #38bdf8; }
        .gw-onboarding .role-title { font-size: 16px; font-weight: 600; color: #f5f5f5; margin-bottom: 4px; }
        .gw-onboarding .role-desc { font-size: 13px; color: #666; line-height: 1.5; }
        .gw-onboarding .footer-hint { text-align: center; font-size: 12px; color: #3a3a3a; padding: 12px 0; }
        .gw-onboarding .back-btn { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #555; background: none; border: none; cursor: pointer; padding: 16px 0 0; font-family: inherit; }
        .gw-onboarding .back-btn:hover { color: #999; }
        .gw-onboarding .nav-tabs { display: flex; margin-bottom: 24px; background: #151515; border-radius: 12px; padding: 4px; }
        .gw-onboarding .nav-tab { flex: 1; padding: 11px; text-align: center; font-size: 14px; font-weight: 500; border-radius: 9px; border: none; cursor: pointer; font-family: inherit; background: transparent; color: #555; transition: all 0.2s; }
        .gw-onboarding .nav-tab.active { background: #222; color: #f5f5f5; }
        .gw-onboarding .form-label { font-size: 13px; font-weight: 500; color: #aaa; display: block; margin-bottom: 6px; }
        .gw-onboarding .form-input { width: 100%; padding: 13px 14px; border-radius: 12px; border: 1px solid #222; font-size: 14px; font-family: inherit; margin-bottom: 16px; background: #151515; color: #e5e5e5; }
        .gw-onboarding .form-input:focus { outline: none; border-color: #f97316; box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.12); }
        .gw-onboarding .form-input::placeholder { color: #444; }
        .gw-onboarding .form-input.blue:focus { border-color: #0ea5e9; box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.12); }
        .gw-onboarding .invite-icon { width: 92px; height: 92px; border-radius: 28px; background: #082338; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px; }
        .gw-onboarding .invite-title { font-size: 24px; font-weight: 600; color: #f5f5f5; margin-bottom: 8px; text-align: center; }
        .gw-onboarding .invite-desc { font-size: 13px; color: #666; line-height: 1.6; text-align: center; max-width: 290px; margin: 0 auto 28px; }
        .gw-onboarding .divider { display: flex; align-items: center; gap: 14px; margin: 28px 0; }
        .gw-onboarding .divider-line { flex: 1; height: 1px; background: #1e1e1e; }
        .gw-onboarding .divider-text { font-size: 12px; color: #444; }
        .gw-onboarding .info-box { padding: 18px; border-radius: 16px; border: 1px solid #1e1e1e; background: #111; display: flex; gap: 14px; align-items: flex-start; }
        .gw-onboarding .info-icon { width: 34px; height: 34px; border-radius: 10px; background: #2a1a08; color: #f59e0b; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .gw-onboarding .info-title { font-size: 14px; font-weight: 600; color: #e5e5e5; margin-bottom: 4px; }
        .gw-onboarding .info-desc { font-size: 12px; color: #666; line-height: 1.5; }
        .gw-onboarding .btn-disabled { opacity: 0.35; cursor: not-allowed; }
        .gw-onboarding .form-error { margin-top: 12px; color: #fb7185; font-size: 13px; line-height: 1.4; }
      `}</style>
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
              <button className="role-card" onClick={() => goTo("employer-auth")}>
                <div className="role-icon employer"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 21V9h6v12"/><path d="M3 9h18"/></svg></div>
                <div><div className="role-title">I&apos;m an employer</div><div className="role-desc">Set up your company, manage jobs, crews, and equipment. Invite your team to join.</div></div>
              </button>
              <button className="role-card employee" onClick={() => goTo("employee-invite")}>
                <div className="role-icon employee"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 2L3 7v5c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V7l-9-5z"/><path d="M12 11v4"/><circle cx="12" cy="8" r="1"/></svg></div>
                <div><div className="role-title">I&apos;m an employee</div><div className="role-desc">Join your company&apos;s workspace. You&apos;ll need an invite from your employer.</div></div>
              </button>
            </div>
          </div>
          <div className="footer-hint">You can change your role later in settings.</div>
        </div>

        <div className="screen" hidden={screen !== "employer-auth"}>
          <button className="back-btn" onClick={() => goTo("role")}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>Back</button>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ textAlign: "center", marginBottom: 32 }}>
              <div className="logo-icon" style={{ margin: "0 auto 14px" }}><svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M12 3L2 12h3v8h14v-8h3L12 3z" fill="white" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/></svg></div>
              <div style={{ fontSize: 20, fontWeight: 600, color: "#f5f5f5", marginBottom: 4 }}>Create your company</div>
              <div style={{ fontSize: 13, color: "#666" }}>Get started with your free trial.</div>
            </div>
            <div className="nav-tabs">
              <button className={`nav-tab${authMode === "signup" ? " active" : ""}`} onClick={() => setAuthMode("signup")}>Sign up</button>
              <button className={`nav-tab${authMode === "login" ? " active" : ""}`} onClick={() => setAuthMode("login")}>Log in</button>
            </div>
            <form onSubmit={submitEmployerAuth}>
              {authMode === "signup" && (
                <>
                  <label className="form-label">Company name</label>
                  <input className="form-input" placeholder="e.g. Smith Excavation LLC" value={company} onChange={(event) => setCompany(event.target.value)} required />
                </>
              )}
              <label className="form-label">Email</label>
              <input className="form-input" type="email" placeholder="you@company.com" value={email} onChange={(event) => setEmail(event.target.value)} required />
              <label className="form-label">Password</label>
              <input className="form-input" type="password" placeholder={authMode === "signup" ? "Create a password" : "Password"} value={password} onChange={(event) => setPassword(event.target.value)} required />
              <button className="primary-btn" style={{ marginTop: 4 }} disabled={loading}>{loading ? "Please wait..." : authMode === "signup" ? "Create account" : "Sign in"}</button>
              {error && <div className="form-error">{error}</div>}
            </form>
          </div>
        </div>

        <div className="screen" hidden={screen !== "employee-invite"}>
          <button className="back-btn" onClick={() => goTo("role")}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>Back</button>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div className="invite-icon"><svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="1.8" strokeLinecap="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 7L2 7"/></svg></div>
            <div className="invite-title">Join your team</div>
            <div className="invite-desc">Your employer needs to invite you before you can access the company workspace. Enter your invite code or link below.</div>
            <div style={{ width: "100%" }}>
              <label className="form-label">Invite code or link</label>
              <input className="form-input blue" placeholder="Paste your invite code or link" value={inviteValue} onChange={(event) => setInviteValue(event.target.value)} />
              <button className={`primary-btn${isInviteReady ? "" : " btn-disabled"}`} style={{ background: "#0ea5e9" }} disabled={!isInviteReady || loading} onClick={continueWithInvite}>Continue with invite</button>
              {error && <div className="form-error">{error}</div>}
            </div>
            <div className="divider"><div className="divider-line" /><div className="divider-text">or</div><div className="divider-line" /></div>
            <div className="info-box" style={{ width: "100%" }}>
              <div className="info-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg></div>
              <div><div className="info-title">Don&apos;t have an invite?</div><div className="info-desc">Ask your employer or supervisor to send you one from their Groundwork Pro dashboard under <strong style={{ color: "#aaa" }}>Team → Invite member</strong>.</div></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
