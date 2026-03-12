export type AppearancePreference = "light" | "dark" | "system";

export const APPEARANCE_STORAGE_KEY = "groundwork.appearance";
const PUBLIC_THEME_PREFIXES = ["/login", "/signup", "/forgot-password", "/proposal/"];
const PUBLIC_THEME_EXACT_PATHS = new Set(["/features", "/pricing", "/testimonials"]);

export function normalizeAppearancePreference(value: unknown): AppearancePreference {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return "system";
}

export function isPublicThemePath(pathname: string | null | undefined): boolean {
  const normalized = String(pathname ?? "").trim() || "/";
  if (normalized === "/") return false;
  if (PUBLIC_THEME_EXACT_PATHS.has(normalized)) return true;
  return PUBLIC_THEME_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function hasStoredAuthSessionCookie(cookieValue: string | null | undefined): boolean {
  const raw = String(cookieValue ?? "");
  return /(?:^|;\s*)sb-[^=;]+-auth-token=/.test(raw);
}

export function resolveTheme(preference: AppearancePreference): "light" | "dark" {
  if (preference === "light" || preference === "dark") return preference;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyAppearancePreference(preference: AppearancePreference) {
  if (typeof document === "undefined") return;
  const resolved = resolveTheme(preference);
  const root = document.documentElement;
  root.dataset.appearance = preference;
  root.dataset.theme = resolved;
  if (resolved === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

export function loadStoredAppearancePreference(): AppearancePreference {
  if (typeof window === "undefined") return "system";
  try {
    const stored = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    return normalizeAppearancePreference(stored ?? "system");
  } catch {
    return "system";
  }
}

export function persistAppearancePreference(preference: AppearancePreference) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, preference);
  } catch {
    // no-op
  }
}

export function setAppearancePreference(preference: AppearancePreference) {
  persistAppearancePreference(preference);
  applyAppearancePreference(preference);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("appearance:change", { detail: preference }));
  }
}
