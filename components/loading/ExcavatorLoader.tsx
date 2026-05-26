'use client';

/**
 * ExcavatorLoader — Groundwork Pro branded loading animation
 *
 * A precision-engineered SVG excavator animation.
 * 60fps CSS keyframe animation, no dependencies.
 * Respects prefers-reduced-motion.
 *
 * Usage:
 *   <ExcavatorLoader />                          // full-screen overlay
 *   <ExcavatorLoader show={!ready} />            // exits when data is ready
 *   <ExcavatorLoader mode="inline" />            // embedded in page
 */

import { useEffect, useRef, useState } from 'react';

// ─── Design tokens ───────────────────────────────────────────────────────────
const O  = '#f97316';   // brand orange
const BG = '#0a0a0a';   // near-black background
const M0 = '#0e0e10';   // darkest metal (cavity fill)
const M1 = '#1a1a1c';   // dark metal
const M2 = '#2a2a2c';   // mid metal
const M3 = '#3c3c3e';   // light metal (highlights)

// ─── Keyframe animations ─────────────────────────────────────────────────────
const STYLES = `
  /* Respect reduced-motion preference */
  @media (prefers-reduced-motion: reduce) {
    .gwp-scene * {
      animation-duration: 0.001ms !important;
      animation-iteration-count: 1 !important;
    }
    .gwp-scene .gwp-logo-g { opacity: 1 !important; transform: none !important; }
    .gwp-scene .gwp-exc    { transform: none !important; }
  }

  /* Excavator drives in from the left */
  @keyframes gwp-drive {
    from { transform: translateX(-340px); }
    to   { transform: translateX(0);      }
  }

  /* Track tread surface scroll — dasharray period = 12 for seamless loop */
  @keyframes gwp-track {
    from { stroke-dashoffset: 0;   }
    to   { stroke-dashoffset: -12; }
  }

  /*
   * Arm sequence — all three joints share the same total duration so their
   * keyframe percentages stay in sync.
   * 0–20 %  : drive-in settles, arm at rest
   * 20–48 % : arm lowers to dig
   * 48–68 % : bucket holds at ground
   * 68–83 % : arm lifts back to rest
   * 83–100% : idle
   */
  @keyframes gwp-boom {
    0%,  20% { transform: rotate( 0deg); }
    48%      { transform: rotate(24deg); }
    64%, 68% { transform: rotate(22deg); }
    83%      { transform: rotate( 0deg); }
    100%     { transform: rotate( 0deg); }
  }
  @keyframes gwp-stick {
    0%,  20% { transform: rotate( 0deg); }
    50%      { transform: rotate(30deg); }
    64%, 68% { transform: rotate(28deg); }
    81%      { transform: rotate( 0deg); }
    100%     { transform: rotate( 0deg); }
  }
  @keyframes gwp-bucket {
    0%,  20% { transform: rotate( 0deg); }
    52%      { transform: rotate(42deg); }
    64%, 68% { transform: rotate(40deg); }
    79%      { transform: rotate( 0deg); }
    100%     { transform: rotate( 0deg); }
  }

  /* Dust particles eject at ~56% (bucket contacts ground) */
  @keyframes gwp-da {
    0%,  56% { opacity: 0;    transform: translate(  0px,   0px) scale(0.2); }
    63%      { opacity: 0.80; transform: translate(  0px,   0px) scale(1.0); }
    82%      { opacity: 0.18; transform: translate(-11px, -19px) scale(0.5); }
    96%,100% { opacity: 0;    transform: translate(-16px, -27px) scale(0.0); }
  }
  @keyframes gwp-db {
    0%,  58% { opacity: 0;    transform: translate(  0px,   0px) scale(0.2); }
    65%      { opacity: 0.65; transform: translate(  0px,   0px) scale(1.0); }
    84%      { opacity: 0.10; transform: translate( 13px, -12px) scale(0.4); }
    97%,100% { opacity: 0;    transform: translate( 20px, -19px) scale(0.0); }
  }
  @keyframes gwp-dc {
    0%,  60% { opacity: 0;    transform: translate( 0px,   0px) scale(0.1); }
    67%      { opacity: 0.50; transform: translate( 0px,   0px) scale(0.8); }
    86%      { opacity: 0;    transform: translate( 5px, -24px) scale(0.2); }
    100%     { opacity: 0; }
  }

  /* Logo sweeps up from beneath the ground line */
  @keyframes gwp-logo {
    0%,  63% { opacity: 0; transform: translateY(7px);  }
    79%, 100%{ opacity: 1; transform: translateY(0);    }
  }
  /* Orange underline expands from center */
  @keyframes gwp-bar {
    0%,  65% { transform: scaleX(0); opacity: 0;    }
    81%, 100%{ transform: scaleX(1); opacity: 0.65; }
  }

  /* Scene fade-out on exit */
  @keyframes gwp-out {
    to { opacity: 0; }
  }
`;

// ─── Props ───────────────────────────────────────────────────────────────────
interface ExcavatorLoaderProps {
  /**
   * Controls visibility. Set to `false` once data is ready.
   * The loader will not exit until BOTH `show === false` AND
   * `minimumDurationMs` has elapsed since mount.
   * Default: `true`.
   */
  show?: boolean;
  /**
   * Minimum time (ms) the loader stays visible, even if `show` goes false
   * earlier. Ensures the animation completes at least once for important flows.
   * Default: 0 (exit as soon as `show` is false).
   */
  minimumDurationMs?: number;
  /** Called once the exit fade fully completes. */
  onComplete?: () => void;
  /**
   * `overlay` — fixed full-screen dark overlay (default).
   * `inline`  — centered block inside layout flow.
   */
  mode?: 'overlay' | 'inline';
  /** Optional status text rendered below the animation. */
  message?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function ExcavatorLoader({
  show = true,
  minimumDurationMs = 0,
  onComplete,
  mode = 'overlay',
  message,
}: ExcavatorLoaderProps) {
  const [exiting, setExiting]   = useState(false);
  const [gone,    setGone]      = useState(false);
  const exitedRef   = useRef(false);
  const mountedAtMs = useRef(Date.now());
  const minTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function triggerExit() {
    if (exitedRef.current) return;
    exitedRef.current = true;
    if (minTimerRef.current) clearTimeout(minTimerRef.current);
    setExiting(true);
    setTimeout(() => { setGone(true); onComplete?.(); }, 440);
  }

  // Hard cap — never block longer than 3.5 s regardless of minimumDurationMs
  useEffect(() => {
    const t = setTimeout(triggerExit, Math.max(minimumDurationMs + 440, 3500));
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Exit when caller signals ready — but honour minimum duration first
  useEffect(() => {
    if (!show) {
      const elapsed   = Date.now() - mountedAtMs.current;
      const remaining = minimumDurationMs - elapsed;
      if (remaining <= 0) {
        triggerExit();
      } else {
        minTimerRef.current = setTimeout(triggerExit, remaining);
      }
    }
    return () => {
      if (minTimerRef.current) clearTimeout(minTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  if (gone) return null;

  // ─── Shared animation constants ─────────────────────────────────────────
  const DUR  = '2.6s';
  const EASE = 'cubic-bezier(0.4,0,0.2,1)';
  const exitAnim = exiting ? `gwp-out 0.42s ${EASE} forwards` : 'none';

  // ─── SVG scene ──────────────────────────────────────────────────────────
  const scene = (
    <>
      <style>{STYLES}</style>
      {/*
       * viewBox 400 × 185
       * Ground line:  y = 152
       * Logo zone:    y = 163–178
       * Excavator:    tracks x 26–144, y 135–157  |  shoulder x 130, y 93
       */}
      <svg
        className="gwp-scene"
        viewBox="0 0 400 185"
        width="400"
        height="185"
        aria-hidden="true"
        style={{ overflow: 'visible', maxWidth: 'min(400px, 88vw)' }}
      >
        <defs>
          {/* Soft glow on orange elements */}
          <filter id="gwp-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.2" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          {/* Wider glow for logo text */}
          <filter id="gwp-lg" x="-60%" y="-80%" width="220%" height="260%">
            <feGaussianBlur stdDeviation="4" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>

        {/* ── Ground reference line ──────────────────────────────────────── */}
        <line
          x1="0" y1="152" x2="400" y2="152"
          stroke={O} strokeWidth="0.75" strokeOpacity="0.22"
        />

        {/* ── Logo — revealed when arm lifts after dig ───────────────────── */}
        <g
          style={{
            animation: `gwp-logo ${DUR} ${EASE} both`,
            transformOrigin: '200px 168px',
          }}
        >
          <text
            x="200" y="168"
            textAnchor="middle"
            fontFamily="-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif"
            fontSize="13"
            fontWeight="700"
            letterSpacing="5"
            fill="white"
            filter="url(#gwp-lg)"
          >
            GROUNDWORK<tspan fill={O}> PRO</tspan>
          </text>
          {/* Accent bar — scales from center outward */}
          <rect
            x="151" y="174" width="98" height="0.8"
            fill={O}
            style={{
              animation: `gwp-bar ${DUR} ${EASE} both`,
              transformOrigin: '200px 174.4px',
            }}
          />
        </g>

        {/* ── Dust particles ─ bucket contact ≈ (208, 151) ──────────────── */}
        <g transform="translate(208,151)">
          <circle r="3.5" fill={O}
            style={{ animation: `gwp-da ${DUR} ${EASE} both` }}/>
          <circle r="2.5" fill="#666"
            style={{ animation: `gwp-db ${DUR} ${EASE} both` }}/>
          <circle r="2"   fill={O}
            style={{ animation: `gwp-dc ${DUR} ${EASE} both` }}/>
          <circle r="2"   fill="#555"
            style={{ animation: `gwp-da ${DUR} 0.06s ${EASE} both` }}/>
        </g>

        {/* ══════════════ Excavator ══════════════════════════════════════ */}
        {/*   Drives in from screen-left on mount.                         */}
        {/*   All interior transforms share the same DUR so arm sync      */}
        {/*   is maintained regardless of drive-in timing.                 */}
        <g
          className="gwp-exc"
          style={{ animation: `gwp-drive 0.52s cubic-bezier(0.16,1,0.3,1) both` }}
        >

          {/* ── Track ─────────────────────────────────────────────────── */}
          {/* Track pad */}
          <rect x="26" y="135" width="118" height="20" rx="10"
            fill={M1} stroke={M3} strokeWidth="1.5"/>
          {/* Tread surface — scrolling dashes simulate belt movement */}
          <line
            x1="36" y1="135" x2="136" y2="135"
            stroke={M2} strokeWidth="5"
            strokeDasharray="8 4"
            style={{ animation: `gwp-track 0.18s linear infinite` }}
          />
          {/* Front drive sprocket */}
          <circle cx="136" cy="145" r="10"  fill={M2} stroke={M3} strokeWidth="1.5"/>
          <circle cx="136" cy="145" r="4.5" fill={M0}/>
          {/* Rear idler sprocket */}
          <circle cx="36"  cy="145" r="10"  fill={M2} stroke={M3} strokeWidth="1.5"/>
          <circle cx="36"  cy="145" r="4.5" fill={M0}/>

          {/* ── Lower frame / car body ──────────────────────────────── */}
          <rect x="38" y="122" width="96" height="17" rx="1.5" fill={M2}/>
          <line x1="42" y1="124.5" x2="130" y2="124.5"
            stroke={M3} strokeWidth="0.5" strokeOpacity="0.5"/>

          {/* ── Upper house ─────────────────────────────────────────── */}
          {/* Main body — slight trapezoid, wider at base */}
          <polygon points="40,122 136,122 133,100 43,100" fill={M2}/>

          {/* Counterweight (rear bulge) */}
          <rect x="28" y="102" width="24" height="22" rx="2"
            fill={M1} stroke={M3} strokeWidth="1"/>
          {/* CW brand dot */}
          <circle cx="40" cy="113" r="5.5" fill={M0}/>
          <circle cx="40" cy="113" r="2.8" fill={O} fillOpacity="0.55"/>

          {/* Cab superstructure */}
          <polygon points="68,84 134,84 134,102 62,102" fill={M2}/>
          {/* Upper fascia (angled roofline) */}
          <polygon points="74,77 134,77 134,86 68,86" fill={M3}/>

          {/* Operator window — deep blue tint, like real glazing */}
          <polygon points="76,84 130,84 130,100 72,100"
            fill="#071522" fillOpacity="0.97"/>
          {/* Glass glare — two subtle highlights */}
          <line x1="78" y1="85.5" x2="102" y2="85.5"
            stroke="white" strokeWidth="0.75" strokeOpacity="0.16"/>
          <line x1="78" y1="89"   x2="89"  y2="89"
            stroke="white" strokeWidth="0.5"  strokeOpacity="0.10"/>

          {/* ── Orange accent lines ──────────────────────────────────── */}
          {/* Cab roofline — primary brand moment */}
          <line x1="74" y1="77" x2="134" y2="77"
            stroke={O} strokeWidth="2.5" filter="url(#gwp-glow)"/>
          {/* Lower body divider */}
          <line x1="40" y1="122" x2="136" y2="122"
            stroke={O} strokeWidth="0.75" strokeOpacity="0.3"/>

          {/* Exhaust stack */}
          <rect x="84" y="70" width="5" height="9" rx="1.5" fill={M2}/>
          <rect x="83" y="67" width="7" height="5"  rx="1"   fill={M1}/>

          {/* ══ Arm assembly ════════════════════════════════════════════ */}
          {/*                                                              */}
          {/*   Nested transform groups: each group's origin (0,0) is     */}
          {/*   the mechanical joint. CSS rotates each group around its    */}
          {/*   own origin, which is exactly the joint center.            */}
          {/*                                                              */}
          {/*   Hierarchy:  shoulder → boom → elbow → stick → wrist → bucket */}

          <g transform="translate(130,93)">
            {/* Shoulder pin */}
            <circle r="7" fill={M3} stroke={M2} strokeWidth="1.5"/>

            {/* ── Boom (pivots at shoulder) ──────────────────────────── */}
            <g style={{ animation: `gwp-boom ${DUR} ${EASE} both`, transformOrigin: '0 0' }}>

              {/* Boom structural member */}
              <line x1="0" y1="0" x2="66" y2="-21"
                stroke={M3} strokeWidth="11" strokeLinecap="round"/>
              {/* Orange edge highlight along top of boom */}
              <line x1="1"  y1="-2" x2="64" y2="-23"
                stroke={O} strokeWidth="1" strokeOpacity="0.38" strokeLinecap="round"/>
              {/* Boom-raise hydraulic cylinder */}
              <line x1="16"  y1="5" x2="58" y2="-9"
                stroke={M2} strokeWidth="4" strokeLinecap="round"/>
              <line x1="32"  y1="0" x2="58" y2="-9"
                stroke={M3} strokeWidth="3" strokeLinecap="round"/>

              {/* ── Elbow (boom tip) ─────────────────────────────────── */}
              <g transform="translate(66,-21)">
                {/* Elbow pin */}
                <circle r="5.5" fill={M3} stroke={M2} strokeWidth="1.5"/>

                {/* ── Stick (pivots at elbow) ──────────────────────── */}
                <g style={{ animation: `gwp-stick ${DUR} ${EASE} both`, transformOrigin: '0 0' }}>

                  {/* Stick arm */}
                  <line x1="0" y1="0" x2="15" y2="49"
                    stroke={M3} strokeWidth="7" strokeLinecap="round"/>
                  {/* Stick-curl hydraulic cylinder */}
                  <line x1="9"  y1="-5" x2="13" y2="39"
                    stroke={M2} strokeWidth="3.5" strokeLinecap="round"/>

                  {/* ── Wrist (stick tip) ──────────────────────────── */}
                  <g transform="translate(15,49)">
                    {/* Wrist pin */}
                    <circle r="4.5" fill={M3} stroke={M2} strokeWidth="1.5"/>

                    {/* ── Bucket (pivots at wrist) ──────────────────── */}
                    <g style={{ animation: `gwp-bucket ${DUR} ${EASE} both`, transformOrigin: '0 0' }}>

                      {/* Bucket shell */}
                      <path
                        d="M0,0 L20,-6 L26,9 L25,27 L2,29 Z"
                        fill={M1} stroke={M3} strokeWidth="1.5" strokeLinejoin="round"
                      />
                      {/* Inner cavity (shadow) */}
                      <path
                        d="M3,4 L18,-2 L22,8 L5,23 Z"
                        fill={M0} fillOpacity="0.75"
                      />
                      {/* Bottom wear plate */}
                      <line x1="3"  y1="25.5" x2="24" y2="25.5"
                        stroke={M3} strokeWidth="2" strokeLinecap="round"/>

                      {/* Bucket teeth — orange, with glow */}
                      <line x1="5"  y1="28" x2="3"  y2="36"
                        stroke={O} strokeWidth="2.5" strokeLinecap="round"
                        filter="url(#gwp-glow)"/>
                      <line x1="12" y1="29" x2="12" y2="37"
                        stroke={O} strokeWidth="2.5" strokeLinecap="round"
                        filter="url(#gwp-glow)"/>
                      <line x1="19" y1="28" x2="20" y2="36"
                        stroke={O} strokeWidth="2.5" strokeLinecap="round"
                        filter="url(#gwp-glow)"/>

                    </g>
                    {/* ── / Bucket ─────────────────────────────────── */}
                  </g>
                  {/* ── / Wrist ──────────────────────────────────────── */}
                </g>
                {/* ── / Stick ────────────────────────────────────────── */}
              </g>
              {/* ── / Elbow ──────────────────────────────────────────── */}
            </g>
            {/* ── / Boom ──────────────────────────────────────────────── */}
          </g>
          {/* ── / Arm assembly ────────────────────────────────────────── */}

        </g>
        {/* ══ / Excavator ═══════════════════════════════════════════════ */}

      </svg>

      {/* Optional status message */}
      {message && (
        <p style={{
          marginTop: 24,
          fontSize: 12,
          fontFamily: '-apple-system,BlinkMacSystemFont,system-ui,sans-serif',
          color: 'rgba(255,255,255,0.4)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}>
          {message}
        </p>
      )}
    </>
  );

  // ─── Render modes ────────────────────────────────────────────────────────
  if (mode === 'inline') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '48px 24px',
          animation: exitAnim,
        }}
        role="status"
        aria-label="Loading"
      >
        {scene}
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: BG,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: exitAnim,
      }}
      role="status"
      aria-label="Loading"
    >
      {scene}
    </div>
  );
}
