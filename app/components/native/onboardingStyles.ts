// The ORIGINAL native onboarding stylesheet, extracted verbatim from
// OnboardingGate.tsx so the onboarding route and the native login route share
// one identical source of styling. Not rewritten — copied exactly, so the
// slides, cards, buttons, and typography render as they always have.
export const NATIVE_ONBOARDING_CSS = `
        body.native-onboarding-open { overflow: hidden; background: #000; }
        .gw-onboarding * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .gw-onboarding { position: fixed; inset: 0; z-index: 9999; background: #000; color: #e5e5e5; font-family: inherit; min-height: 100svh; min-height: 100dvh; height: 100svh; height: 100dvh; overflow: hidden; }
        .gw-onboarding .phone-frame { width: 100%; min-height: 100svh; min-height: 100dvh; background: #0a0a0a; overflow: hidden; position: relative; color: #e5e5e5; }
        .gw-onboarding .phone-notch { display: none; }
        .gw-onboarding .screen { padding: max(env(safe-area-inset-top), 0px) 28px max(36px, env(safe-area-inset-bottom)); display: flex; flex-direction: column; min-height: 100svh; min-height: 100dvh; height: 100svh; height: 100dvh; animation: fadeUp 0.35s ease-out; overflow-y: auto; overscroll-behavior: contain; }
        .gw-onboarding .screen[hidden] { display: none !important; }
        .gw-onboarding .skip-btn { text-align: right; padding: 16px 0 0; font-size: 13px; color: #555; cursor: pointer; background: none; border: none; font-family: inherit; }
        .gw-onboarding .skip-btn:hover { color: #999; }
        .gw-onboarding .feature-area { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
        .gw-onboarding .feature-icon { width: 100px; height: 100px; border-radius: 28px; display: flex; align-items: center; justify-content: center; margin: 0 auto 28px; }
        .gw-onboarding .feature-icon svg { display: block; width: 42px; height: 42px; margin: 0 auto; overflow: visible; vector-effect: non-scaling-stroke; }
        .gw-onboarding .feature-title { font-family: "Dozer", sans-serif; font-size: 24px; font-weight: 600; color: #f5f5f5; margin-bottom: 10px; letter-spacing: 0.02em; }
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
        .gw-onboarding .logo-text { font-family: "Dozer", sans-serif; font-size: 24px; font-weight: 700; letter-spacing: 0.08em; color: #f5f5f5; }
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
        .gw-onboarding .auth-title,
        .gw-onboarding .invite-title { font-family: "Dozer", sans-serif; font-size: 24px; font-weight: 600; color: #f5f5f5; margin-bottom: 8px; text-align: center; letter-spacing: 0.02em; }
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
        .gw-onboarding .secondary-link { width: 100%; margin-top: 14px; border: none; background: transparent; color: #f97316; cursor: pointer; font: inherit; font-size: 13px; font-weight: 600; text-align: center; }
        .gw-onboarding .secondary-link:hover { color: #fb923c; }
      `;
