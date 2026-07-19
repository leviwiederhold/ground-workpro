"use client";

// TEMPORARY DIAGNOSTIC — remove once native login is confirmed working on device.
//
// Renders a visible badge on non-production hosts only, reporting the facts
// needed to tell apart the ways native login can fail to appear:
//   - which host the WebView actually loaded (production vs preview)
//   - whether Capacitor's bridge is present and what platform it reports
//   - the resolved nativeRuntime value
//   - whether the native provider button JSX branch actually rendered
//
// Never renders on the production host, so it cannot leak into the shipped app
// even if this file is accidentally left in place.

import { useEffect, useState } from "react";

const PRODUCTION_HOST = "ground-workpro.vercel.app";

type Diagnostics = {
  href: string;
  host: string;
  isNativePlatform: boolean | "unavailable";
  platform: string;
  markerFlag: boolean;
  localStorageFlag: string | null;
  gwNativeParam: string | null;
  nativeRuntime: boolean;
  nativeAuthUiRendered: boolean;
};

export function isNonProductionHost(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.host !== PRODUCTION_HOST;
}

export default function NativeAuthDebugBadge(props: {
  nativeRuntime: boolean;
  nativeAuthUiRendered: boolean;
}) {
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);

  useEffect(() => {
    if (!isNonProductionHost()) return;

    const w = window as typeof window & {
      __GROUNDWORK_NATIVE_APP__?: boolean | string;
      Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
    };

    let isNativePlatform: boolean | "unavailable" = "unavailable";
    try {
      if (typeof w.Capacitor?.isNativePlatform === "function") {
        isNativePlatform = w.Capacitor.isNativePlatform();
      }
    } catch {
      isNativePlatform = "unavailable";
    }

    let platform = "unavailable";
    try {
      if (typeof w.Capacitor?.getPlatform === "function") platform = String(w.Capacitor.getPlatform());
    } catch {
      platform = "unavailable";
    }

    let localStorageFlag: string | null = null;
    try {
      localStorageFlag = window.localStorage.getItem("groundwork.nativeApp");
    } catch {
      localStorageFlag = "(unavailable)";
    }

    const next: Diagnostics = {
      href: window.location.href,
      host: window.location.host,
      isNativePlatform,
      platform,
      markerFlag: w.__GROUNDWORK_NATIVE_APP__ === true || w.__GROUNDWORK_NATIVE_APP__ === "1",
      localStorageFlag,
      gwNativeParam: new URLSearchParams(window.location.search).get("gw_native"),
      nativeRuntime: props.nativeRuntime,
      nativeAuthUiRendered: props.nativeAuthUiRendered,
    };

    setDiagnostics(next);

    // Also log, so the values are visible in the Xcode/Safari console even if
    // the badge is scrolled out of view.
    console.log("[native-auth-debug] window.location.href:", next.href);
    console.log("[native-auth-debug] Capacitor.isNativePlatform():", next.isNativePlatform);
    console.log("[native-auth-debug] Capacitor.getPlatform():", next.platform);
    console.log("[native-auth-debug] __GROUNDWORK_NATIVE_APP__ marker:", next.markerFlag);
    console.log("[native-auth-debug] localStorage groundwork.nativeApp:", next.localStorageFlag);
    console.log("[native-auth-debug] ?gw_native param:", next.gwNativeParam);
    console.log("[native-auth-debug] nativeRuntime:", next.nativeRuntime);
    console.log("[native-auth-debug] native provider button branch rendered:", next.nativeAuthUiRendered);
  }, [props.nativeRuntime, props.nativeAuthUiRendered]);

  if (!diagnostics) return null;

  const ok = diagnostics.nativeAuthUiRendered;

  return (
    <div
      data-testid="native-auth-debug-badge"
      className={`mb-4 rounded-lg border px-3 py-2 text-left font-mono text-[11px] leading-relaxed ${
        ok ? "border-green-300 bg-green-50 text-green-900" : "border-amber-300 bg-amber-50 text-amber-900"
      }`}
    >
      <div className="font-semibold">NATIVE AUTH DEBUG (non-production only)</div>
      <div>host: {diagnostics.host}</div>
      <div>platform: {diagnostics.platform}</div>
      <div>isNativePlatform: {String(diagnostics.isNativePlatform)}</div>
      <div>marker: {String(diagnostics.markerFlag)}</div>
      <div>localStorage: {String(diagnostics.localStorageFlag)}</div>
      <div>gw_native param: {String(diagnostics.gwNativeParam)}</div>
      <div>nativeRuntime: {String(diagnostics.nativeRuntime)}</div>
      <div>native auth UI: {ok ? "ENABLED" : "DISABLED"}</div>
    </div>
  );
}
