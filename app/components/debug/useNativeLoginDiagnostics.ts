"use client";

// Console-only diagnostics for the native login route.
//
// Previously this rendered a collapsible panel at the bottom of the native login
// screen. It is now console-only: nothing is added to the UI on any host. The
// same values are still logged on non-production hosts, so device debugging via
// the Xcode/Safari console is unchanged.

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { readNativeRuntimeSignals } from "@/lib/runtime/detectNativeLoginRuntime";

const PRODUCTION_HOST = "ground-workpro.vercel.app";

export function isDiagnosticsHost(host: string): boolean {
  return host !== PRODUCTION_HOST;
}

/** Logs native-runtime diagnostics. Renders nothing and returns nothing. */
export function useNativeLoginDiagnostics(): void {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isDiagnosticsHost(window.location.host)) return;

    const detection = readNativeRuntimeSignals(window);

    console.log("[native-login] pathname:", pathname ?? window.location.pathname);
    console.log("[native-login] hostname:", window.location.host);
    console.log("[native-login] configured server URL:", window.location.origin);
    console.log("[native-login] bridge available:", detection.bridgeAvailable);
    console.log("[native-login] platform:", detection.platform);
    console.log("[native-login] native runtime:", detection.isNative);
  }, [pathname]);
}
