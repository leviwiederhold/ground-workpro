"use client";

// Preview/development-only diagnostics for the NATIVE login route.
//
// Rendered only on /native/login and only when the host is not production, so
// nothing appears on the website or in the shipped app. Purely informational —
// it does not influence whether the native UI renders (the route decides that).

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { readNativeRuntimeSignals } from "@/lib/runtime/detectNativeLoginRuntime";

const PRODUCTION_HOST = "ground-workpro.vercel.app";

export function isDiagnosticsHost(host: string): boolean {
  return host !== PRODUCTION_HOST;
}

type Snapshot = {
  pathname: string;
  host: string;
  bridgeAvailable: boolean;
  platform: string | null;
  serverUrl: string;
  isNative: boolean;
};

export default function NativeLoginDiagnostics() {
  const pathname = usePathname();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isDiagnosticsHost(window.location.host)) return;

    const detection = readNativeRuntimeSignals(window);
    const next: Snapshot = {
      pathname: pathname ?? window.location.pathname,
      host: window.location.host,
      bridgeAvailable: detection.bridgeAvailable,
      platform: detection.platform,
      serverUrl: window.location.origin,
      isNative: detection.isNative,
    };

    setSnapshot(next);

    console.log("[native-login] pathname:", next.pathname);
    console.log("[native-login] hostname:", next.host);
    console.log("[native-login] bridge available:", next.bridgeAvailable);
    console.log("[native-login] platform:", next.platform);
    console.log("[native-login] configured server URL:", next.serverUrl);
  }, [pathname]);

  if (!snapshot) return null;

  // Collapsed by default so it never displaces the onboarding/login UI. The
  // same values are always written to the console, so console-only debugging
  // works without expanding anything.
  return (
    <details
      data-testid="native-login-diagnostics"
      style={{
        marginTop: 20,
        borderRadius: 10,
        border: "1px solid #1e1e1e",
        background: "#111",
        padding: "8px 10px",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
        lineHeight: 1.6,
        color: "#666",
      }}
    >
      <summary style={{ cursor: "pointer", color: "#555" }}>diagnostics (preview only)</summary>
      <div style={{ marginTop: 6 }}>
        <div>pathname: {snapshot.pathname}</div>
        <div>hostname: {snapshot.host}</div>
        <div>server URL: {snapshot.serverUrl}</div>
        <div>bridge: {String(snapshot.bridgeAvailable)}</div>
        <div>platform: {String(snapshot.platform)}</div>
        <div>native runtime: {String(snapshot.isNative)}</div>
      </div>
    </details>
  );
}
