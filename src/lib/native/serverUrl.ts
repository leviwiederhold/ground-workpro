// Resolution + validation of the URL the native iOS WebView loads.
//
// The iOS app is a remote-URL Capacitor shell: it does not bundle the web app,
// it loads a deployed site. That URL is baked into ios/App/App/capacitor.config.json
// by `npx cap sync ios`, so pointing the app at a PR preview deployment is a
// sync-time decision, not a runtime one.
//
// This module is the single source of truth for that decision so capacitor.config.ts,
// the sync helper scripts, and the unit tests cannot disagree about what counts
// as a valid or production URL.

// The safe default. Any build that does not explicitly opt into another target
// loads this, and Release archives are not allowed to ship anything else
// (see ios/Scripts/validate-server-url.sh).
export const PRODUCTION_SERVER_URL = "https://ground-workpro.vercel.app";

export type ServerUrlResolution =
  | { ok: true; url: string; isProduction: boolean; source: "default" | "environment" }
  | { ok: false; message: string };

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") && value.length > 1 ? value.slice(0, -1) : value;
}

// A host is "production" only if it is exactly the production host. Vercel
// preview deployments look like groundwork-pro-git-<branch>-<scope>.vercel.app
// or <project>-<hash>.vercel.app, which must never reach an archive.
export function isProductionServerUrl(url: string): boolean {
  try {
    return new URL(url).host === new URL(PRODUCTION_SERVER_URL).host;
  } catch {
    return false;
  }
}

// Validate a candidate URL. Returns a message rather than throwing so callers
// can decide whether an invalid value is a hard failure (cap sync) or a warning.
export function validateServerUrl(rawValue: string): { ok: true; url: string } | { ok: false; message: string } {
  const value = rawValue.trim();

  if (!value) {
    return {
      ok: false,
      message: "CAPACITOR_SERVER_URL is set but empty. Unset it to use the production default, or set a full URL.",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return {
      ok: false,
      message: `CAPACITOR_SERVER_URL is not a valid URL: "${value}". Include the scheme, e.g. https://my-preview.vercel.app`,
    };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return {
      ok: false,
      message: `CAPACITOR_SERVER_URL must be http or https, got "${parsed.protocol}" in "${value}".`,
    };
  }

  if (!parsed.hostname) {
    return { ok: false, message: `CAPACITOR_SERVER_URL has no host: "${value}".` };
  }

  // A path is a common paste error (copying a deep link out of the browser) and
  // would make every route in the app resolve under that prefix.
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    return {
      ok: false,
      message: `CAPACITOR_SERVER_URL must be an origin with no path, got "${parsed.pathname}" in "${value}".`,
    };
  }

  if (parsed.search || parsed.hash) {
    return {
      ok: false,
      message: `CAPACITOR_SERVER_URL must not include a query string or fragment: "${value}".`,
    };
  }

  return { ok: true, url: stripTrailingSlash(parsed.origin) };
}

// Resolve the URL to sync into the iOS project. An unset variable is the normal
// production case; a set-but-invalid variable is an error, never a silent
// fallback to production — that would ship a build that looks configured but
// points somewhere else than the developer intended.
export function resolveServerUrl(rawValue: string | undefined | null): ServerUrlResolution {
  if (rawValue === undefined || rawValue === null || rawValue.trim() === "") {
    return { ok: true, url: PRODUCTION_SERVER_URL, isProduction: true, source: "default" };
  }

  const validated = validateServerUrl(rawValue);
  if (!validated.ok) return validated;

  return {
    ok: true,
    url: validated.url,
    isProduction: isProductionServerUrl(validated.url),
    source: "environment",
  };
}
