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

  return (
    <div
      data-testid="native-login-diagnostics"
      className="mb-4 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-left font-mono text-[11px] leading-relaxed text-blue-900"
    >
      <div className="font-semibold">NATIVE ROUTE DIAGNOSTICS (non-production only)</div>
      <div>pathname: {snapshot.pathname}</div>
      <div>hostname: {snapshot.host}</div>
      <div>server URL: {snapshot.serverUrl}</div>
      <div>bridge: {String(snapshot.bridgeAvailable)}</div>
      <div>platform: {String(snapshot.platform)}</div>
      <div>native runtime: {String(snapshot.isNative)}</div>
    </div>
  );
}
