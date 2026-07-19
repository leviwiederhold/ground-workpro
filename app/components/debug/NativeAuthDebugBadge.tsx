"use client";

// Development/preview-only diagnostics for native login detection.
//
// Reports the facts needed to tell apart the ways native login can fail:
//   - which host the WebView actually loaded (production vs preview)
//   - the gw_native URL parameter
//   - the Capacitor platform and whether the bridge is available
//   - every individual detection signal, and which one matched
//   - the final detectNativeLoginRuntime() result
//
// Gated on the host NOT being production, so it can never appear in the shipped
// app. Production therefore carries no diagnostic noise.

import { useEffect, useState } from "react";
import { readNativeRuntimeSignals, type NativeRuntimeDetection } from "@/lib/runtime/detectNativeLoginRuntime";

const PRODUCTION_HOST = "ground-workpro.vercel.app";

export function isDiagnosticsHost(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.host !== PRODUCTION_HOST;
}

type Snapshot = {
  host: string;
  gwNative: string | null;
  detection: NativeRuntimeDetection;
  nativeAuthUiRendered: boolean;
};

export default function NativeAuthDebugBadge(props: {
  nativeRuntime: boolean;
  nativeAuthUiRendered: boolean;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  useEffect(() => {
    if (!isDiagnosticsHost()) return;

    const detection = readNativeRuntimeSignals(window);
    const gwNative = new URLSearchParams(window.location.search).get("gw_native");

    setSnapshot({
      host: window.location.host,
      gwNative,
      detection,
      nativeAuthUiRendered: props.nativeAuthUiRendered,
    });

    console.log("[native-login] hostname:", window.location.host);
    console.log("[native-login] gw_native:", gwNative);
    console.log("[native-login] Capacitor platform:", detection.platform);
    console.log("[native-login] bridge available:", detection.bridgeAvailable);
    console.log("[native-login] signals:", detection.signals);
    console.log("[native-login] matched signal:", detection.matched);
    console.log("[native-login] detectNativeLoginRuntime():", detection.isNative);
    console.log("[native-login] native provider buttons rendered:", props.nativeAuthUiRendered);
  }, [props.nativeRuntime, props.nativeAuthUiRendered]);

  if (!snapshot) return null;

  const { detection } = snapshot;
  const ok = snapshot.nativeAuthUiRendered;

  return (
    <div
      data-testid="native-login-debug-badge"
      className={`mb-4 rounded-lg border px-3 py-2 text-left font-mono text-[11px] leading-relaxed ${
        ok ? "border-green-300 bg-green-50 text-green-900" : "border-amber-300 bg-amber-50 text-amber-900"
      }`}
    >
      <div className="font-semibold">NATIVE LOGIN DIAGNOSTICS (non-production only)</div>
      <div>host: {snapshot.host}</div>
      <div>gw_native: {String(snapshot.gwNative)}</div>
      <div>platform: {String(detection.platform)}</div>
      <div>bridge: {String(detection.bridgeAvailable)}</div>
      <div>
        signals:{" "}
        {Object.entries(detection.signals)
          .filter(([, on]) => on)
          .map(([name]) => name)
          .join(", ") || "none"}
      </div>
      <div>matched: {String(detection.matched)}</div>
      <div>detectNativeLoginRuntime: {String(detection.isNative)}</div>
      <div>native auth UI: {ok ? "ENABLED" : "DISABLED"}</div>
    </div>
  );
}
