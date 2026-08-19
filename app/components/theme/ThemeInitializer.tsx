"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  applyAppearancePreference,
  FORCE_PUBLIC_THEME_SESSION_KEY,
  hasStoredAuthSessionCookie,
  hasStoredAuthSessionLocalStorage,
  isPublicThemePath,
  loadStoredAppearancePreference,
  normalizeAppearancePreference,
  type AppearancePreference,
} from "@/lib/theme/appearance";

export function ThemeInitializer() {
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    let authenticatedThemeEnabled = pathname !== "/";
    const isPublicPath = isPublicThemePath(pathname);
    const readForcePublicTheme = () => {
      if (typeof window === "undefined") return false;
      try {
        return window.sessionStorage.getItem(FORCE_PUBLIC_THEME_SESSION_KEY) === "1";
      } catch {
        return false;
      }
    };
    const clearForcePublicTheme = () => {
      if (typeof window === "undefined") return;
      try {
        window.sessionStorage.removeItem(FORCE_PUBLIC_THEME_SESSION_KEY);
      } catch {
        // Storage can be unavailable in locked-down WebViews or privacy modes.
      }
    };
    const forcePublicTheme = readForcePublicTheme();

    const applyStored = () => {
      const stored = loadStoredAppearancePreference();
      applyAppearancePreference(stored);
      return stored;
    };

    const hasPersistedPreference = () => {
      if (typeof window === "undefined") return false;
      try {
        return window.localStorage.getItem("groundwork.appearance") !== null;
      } catch {
        return false;
      }
    };

    const syncFromAccountSettings = async () => {
      try {
        const supabase = supabaseBrowser();
        const session = await supabase.auth.getSession();
        if (!session.data.session || cancelled) return;

        const response = await fetch("/api/account-settings", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.item || cancelled) return;

        if (hasPersistedPreference()) return;

        const preference = normalizeAppearancePreference(payload.item.appearance) as AppearancePreference;
        applyAppearancePreference(preference);
        try {
          window.localStorage.setItem("groundwork.appearance", preference);
        } catch {
          // no-op
        }
      } catch {
        // no-op
      }
    };

    if (isPublicPath) {
      applyAppearancePreference("light");
      return;
    }

    const authStorageHint =
      hasStoredAuthSessionCookie(typeof document !== "undefined" ? document.cookie : "") ||
      hasStoredAuthSessionLocalStorage(typeof window !== "undefined" ? window.localStorage : null);
    const activateAuthenticatedTheme = () => {
      if (cancelled) return;
      clearForcePublicTheme();
      authenticatedThemeEnabled = true;
      applyStored();
      void syncFromAccountSettings();
    };

    if (pathname !== "/" || (authStorageHint && !forcePublicTheme)) {
      activateAuthenticatedTheme();
    } else {
      applyAppearancePreference("light");
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChanged = () => {
      if (!authenticatedThemeEnabled) return;
      const current = loadStoredAppearancePreference();
      if (current === "system") applyAppearancePreference("system");
    };
    const onAppearanceChange = () => {
      if (!authenticatedThemeEnabled) return;
      applyAppearancePreference(loadStoredAppearancePreference());
    };

    const supabase = supabaseBrowser();
    if (pathname === "/") {
      void supabase.auth.getSession().then(({ data }) => {
        if (cancelled) return;
        if (data.session) activateAuthenticatedTheme();
        else {
          authenticatedThemeEnabled = false;
          applyAppearancePreference("light");
        }
      });
    }
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled || pathname !== "/") return;
      if (session) activateAuthenticatedTheme();
      else {
        authenticatedThemeEnabled = false;
        applyAppearancePreference("light");
      }
    });

    media.addEventListener("change", onSystemChanged);
    window.addEventListener("appearance:change", onAppearanceChange);
    return () => {
      cancelled = true;
      authListener.subscription.unsubscribe();
      media.removeEventListener("change", onSystemChanged);
      window.removeEventListener("appearance:change", onAppearanceChange);
    };
  }, [pathname]);

  return null;
}
