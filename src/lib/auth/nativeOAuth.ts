/* eslint-disable @typescript-eslint/no-explicit-any */
// Native (iOS) Sign in with Apple + Google via Supabase's ID-token flow.
//
// The Groundwork Pro iOS app is a remote-URL Capacitor WebView. Redirect-based
// OAuth is blocked by Google inside embedded WebViews, so we use the NATIVE
// ID-token flow instead: a Capacitor plugin runs Apple's sheet / Google's native
// sign-in and returns an ID token (+ nonce for Apple). We hand that token to
// `supabase.auth.signInWithIdToken(...)`, which restores the Supabase session
// DIRECTLY in the WebView — no browser redirect, no /auth/callback, no
// deep-link, and therefore no callback loop. Everything after (invite accept,
// membership, company routing) reuses the existing, unchanged flow.
//
// The plugin packages are imported dynamically INSIDE the runtime functions so
// this module can be imported (and its pure helpers unit-tested) without the
// native plugins being present or executed. Callers must only invoke the
// runtime functions when `isNativeAppRuntime()` is true.

import type { SupabaseClient } from "@supabase/supabase-js";

export type NativeProvider = "apple" | "google";

export type NativeSignInResult =
  | { status: "success"; provider: NativeProvider; fullName: string | null }
  | { status: "cancelled" }
  | { status: "error"; message: string };

type SocialLoginPlugin = {
  initialize(options: Record<string, unknown>): Promise<void>;
  login(options: Record<string, unknown>): Promise<any>;
};

type SocialLoginLoader = () => Promise<{ SocialLogin: SocialLoginPlugin }>;

let initializedSocialLogin: SocialLoginPlugin | null = null;
let providerInitializationInFlight: Promise<SocialLoginPlugin> | null = null;

// The app's PRODUCTION iOS bundle identifier.
//
// This is the identity of the already-shipped Groundwork Pro app — verified
// against the Xcode archives on record (latest: 2026-05-12), all of which have
// CFBundleIdentifier = com.leviwiederhold.groundworkpro. It must stay in sync
// with:
//   - ios/App/App.xcodeproj PRODUCT_BUNDLE_IDENTIFIER (Debug + Release)
//   - capacitor.config.ts `appId`
//   - the Apple App ID that has "Sign in with Apple" enabled
//   - Supabase's Apple "authorized client IDs"
//
// It is also the `aud` claim of the Apple identity token, which is why Supabase
// rejects the token if this and the Supabase setting disagree.
export const IOS_BUNDLE_ID = "com.leviwiederhold.groundworkpro";
export const NATIVE_PENDING_INVITE_STORAGE_KEY = "groundwork:native-pending-invite";

export type PendingInviteState = {
  invite: "1";
  token?: string;
  role?: string;
  email?: string;
  employeeId?: string;
  companyName?: string;
};

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested — no plugin/native dependency)
// ---------------------------------------------------------------------------

// URL-safe random nonce. Apple requires a nonce to bind the ID token to this
// request: we send SHA-256(rawNonce) to Apple (it becomes the token's `nonce`
// claim) and pass the RAW nonce to Supabase, which re-hashes and compares.
export function generateRawNonce(length = 32): string {
  const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._";
  const bytes = new Uint8Array(length);
  const cryptoObj = (globalThis as any)?.crypto as Crypto | undefined;
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = "";
  for (let i = 0; i < length; i += 1) out += charset[bytes[i] % charset.length];
  return out;
}

// Decode a JWT payload WITHOUT verifying it.
//
// This is only ever used to read the `nonce` claim so the value we hand Supabase
// matches the token. Supabase performs the real signature/issuer/audience
// verification server-side; nothing here is trusted for authorization.
export function decodeIdTokenPayload(token: string): Record<string, unknown> | null {
  const parts = String(token ?? "").split(".");
  if (parts.length < 2 || !parts[1]) return null;

  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const decode = (globalThis as any).atob as ((value: string) => string) | undefined;
    if (typeof decode !== "function") return null;

    const binary = decode(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// The `nonce` claim of an ID token, or null when absent/blank.
//
// Supabase rejects an asymmetric request: "Passed nonce and nonce in id_token
// should either both exist or not." Reading the claim lets the caller stay
// symmetric no matter what the provider plugin did.
export function readIdTokenNonce(token: string): string | null {
  const payload = decodeIdTokenPayload(token);
  const nonce = payload?.nonce;
  if (typeof nonce !== "string") return null;
  const trimmed = nonce.trim();
  return trimmed ? trimmed : null;
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await (globalThis as any).crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Apple only returns the user's name on the FIRST authorization. Compose it so
// the caller can persist it through the existing invite/profile flow.
export function buildFullName(given?: string | null, family?: string | null): string | null {
  const name = [given, family]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  return name || null;
}

export function readPendingInviteFromSearch(search: string): PendingInviteState | null {
  const params = new URLSearchParams(search);
  if (params.get("invite") !== "1") return null;

  const state: PendingInviteState = { invite: "1" };
  for (const key of ["token", "role", "email", "employeeId", "companyName"] as const) {
    const value = params.get(key);
    if (value) state[key] = value;
  }
  return state;
}

export function writePendingInviteState(state: PendingInviteState | null, storage: Storage | null | undefined): void {
  if (!storage) return;
  if (!state) {
    storage.removeItem(NATIVE_PENDING_INVITE_STORAGE_KEY);
    return;
  }
  storage.setItem(NATIVE_PENDING_INVITE_STORAGE_KEY, JSON.stringify(state));
}

export function readPendingInviteState(storage: Storage | null | undefined): PendingInviteState | null {
  if (!storage) return null;
  const raw = storage.getItem(NATIVE_PENDING_INVITE_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingInviteState>;
    if (parsed?.invite !== "1") return null;
    const state: PendingInviteState = { invite: "1" };
    for (const key of ["token", "role", "email", "employeeId", "companyName"] as const) {
      if (typeof parsed[key] === "string") state[key] = parsed[key];
    }
    return state;
  } catch {
    storage.removeItem(NATIVE_PENDING_INVITE_STORAGE_KEY);
    return null;
  }
}

// Detect a user-cancelled native sign-in across the different plugin error
// shapes, so the UI returns to a usable login screen instead of showing an
// error. (Apple: 1001 / "canceled"; Google: 12501 / "cancel".)
export function isUserCancelledError(err: unknown): boolean {
  const anyErr = err as any;
  const code = String(anyErr?.code ?? "").toLowerCase();
  const msg = String(anyErr?.message ?? anyErr ?? "").toLowerCase();
  return (
    code === "1001" ||
    code === "12501" ||
    code.includes("cancel") ||
    msg.includes("1001") ||
    msg.includes("12501") ||
    msg.includes("cancel") || // covers cancel / canceled / cancelled
    msg.includes("popup_closed") ||
    (msg.includes("the operation couldn’t be completed") && msg.includes("1001"))
  );
}

// ---------------------------------------------------------------------------
// Google client configuration + validation
// ---------------------------------------------------------------------------

export type GoogleClientConfig = { iosClientId: string; webClientId: string };

export type GoogleClientConfigResult =
  | { ok: true; config: GoogleClientConfig }
  | { ok: false; message: string };

const GOOGLE_CLIENT_ID_SUFFIX = ".apps.googleusercontent.com";

// Validate the two public Google client IDs the native flow needs.
//
// These are inlined by Next.js at BUILD time, so they must be set in the Vercel
// project (the iOS app loads the deployed site, not a local build) and the
// project must be REDEPLOYED after adding them — setting them without a rebuild
// leaves the shipped bundle with `undefined`. The error messages below name the
// exact variables so a failed sign-in on a device is self-diagnosing instead of
// a generic "not configured".
//
// Split from the env read so it can be unit-tested without mutating process.env.
export function validateGoogleClientConfig(input: {
  iosClientId: string | undefined;
  webClientId: string | undefined;
}): GoogleClientConfigResult {
  const iosClientId = String(input.iosClientId ?? "").trim();
  const webClientId = String(input.webClientId ?? "").trim();

  const missing: string[] = [];
  if (!iosClientId) missing.push("NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID");
  if (!webClientId) missing.push("NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID");
  if (missing.length > 0) {
    return {
      ok: false,
      message: `Google sign-in is not configured for this build: missing ${missing.join(
        " and ",
      )}. Set them in the Vercel project and redeploy.`,
    };
  }

  // A client ID that doesn't look like one is almost always a copy/paste of the
  // wrong field (project number, client secret, or the reversed iOS ID).
  const malformed = [
    ["NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID", iosClientId],
    ["NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID", webClientId],
  ].filter(([, value]) => !value.endsWith(GOOGLE_CLIENT_ID_SUFFIX));
  if (malformed.length > 0) {
    return {
      ok: false,
      message: `Google sign-in is misconfigured: ${malformed
        .map(([name]) => name)
        .join(" and ")} must end with "${GOOGLE_CLIENT_ID_SUFFIX}".`,
    };
  }

  // The iOS and Web client IDs are different OAuth clients. If they match, the
  // iOS one was never created, and Supabase would reject the token's audience.
  if (iosClientId === webClientId) {
    return {
      ok: false,
      message:
        "Google sign-in is misconfigured: NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID and NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID are the same value. The iOS client ID must come from an OAuth client of type iOS.",
    };
  }

  return { ok: true, config: { iosClientId, webClientId } };
}

// Read + validate in one step. The env vars are referenced as static literals
// because Next.js only inlines NEXT_PUBLIC_* on literal member access.
export function readGoogleClientConfig(): GoogleClientConfigResult {
  return validateGoogleClientConfig({
    iosClientId: process.env.NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    webClientId: process.env.NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  });
}

export function buildNativeProviderInitializationOptions(): Record<string, unknown> {
  const google = readGoogleClientConfig();
  return {
    // On iOS an empty redirect keeps Sign in with Apple in the native sheet.
    apple: { clientId: IOS_BUNDLE_ID, redirectUrl: "" },
    ...(google.ok
      ? {
          google: {
            iOSClientId: google.config.iosClientId,
            iOSServerClientId: google.config.webClientId,
            webClientId: google.config.webClientId,
            mode: "online",
          },
        }
      : {}),
  };
}

const loadSocialLogin: SocialLoginLoader = async () =>
  (await import("@capgo/capacitor-social-login")) as unknown as {
    SocialLogin: SocialLoginPlugin;
  };

/**
 * Initialize every configured native provider together.
 *
 * Calls are coalesced while initialization is running and cached afterward.
 * Login-screen mount and app-resume callers may force a safe reinitialization;
 * the plugin's initialize operation only replaces provider configuration and
 * registers no JS listeners.
 */
export function initializeNativeAuthProviders({
  force = false,
  loader = loadSocialLogin,
}: {
  force?: boolean;
  loader?: SocialLoginLoader;
} = {}): Promise<SocialLoginPlugin> {
  if (providerInitializationInFlight) return providerInitializationInFlight;
  if (initializedSocialLogin && !force) return Promise.resolve(initializedSocialLogin);

  const run = (async () => {
    const { SocialLogin } = await loader();
    await SocialLogin.initialize(buildNativeProviderInitializationOptions());
    initializedSocialLogin = SocialLogin;
    return SocialLogin;
  })();
  providerInitializationInFlight = run;
  void run.finally(() => {
    if (providerInitializationInFlight === run) providerInitializationInFlight = null;
  }).catch(() => {});
  return run;
}

/** Test-only reset for the module-scoped idempotency state. */
export function resetNativeAuthProviderInitializationForTests(): void {
  initializedSocialLogin = null;
  providerInitializationInFlight = null;
}

// Post-authentication routing now lives in src/lib/auth/loginFlow.ts as
// resolveNativePostAuthDestination(), shared by the native login route. The
// earlier resolvePostAuthRoute() helper here became unreachable when the
// dedicated /native routes replaced the runtime-detected login screen.

// ---------------------------------------------------------------------------
// Runtime flows (native only) — thin glue over the plugins + Supabase.
// ---------------------------------------------------------------------------

export async function signInWithAppleNative(supabase: SupabaseClient): Promise<NativeSignInResult> {
  try {
    const rawNonce = generateRawNonce();
    const hashedNonce = await sha256Hex(rawNonce);

    const SocialLogin = await initializeNativeAuthProviders();

    const result = await SocialLogin.login({
      provider: "apple",
      options: {
        scopes: ["email", "name"],
        nonce: hashedNonce,
      },
    });

    const response = result?.result ?? {};
    const idToken: string | undefined = response.idToken ?? response.identityToken;
    if (!idToken) {
      return { status: "error", message: "Apple did not return an identity token. Please try again." };
    }

    const { error } = await supabase.auth.signInWithIdToken({
      provider: "apple",
      token: idToken,
      nonce: rawNonce,
    });
    if (error) return { status: "error", message: error.message };

    return {
      status: "success",
      provider: "apple",
      fullName: buildFullName(response.givenName ?? response.firstName, response.familyName ?? response.lastName),
    };
  } catch (err) {
    if (isUserCancelledError(err)) return { status: "cancelled" };
    return { status: "error", message: err instanceof Error ? err.message : "Apple sign-in failed." };
  }
}

export async function signInWithGoogleNative(supabase: SupabaseClient): Promise<NativeSignInResult> {
  try {
    const configResult = readGoogleClientConfig();
    if (!configResult.ok) {
      return { status: "error", message: configResult.message };
    }
    const SocialLogin = await initializeNativeAuthProviders();

    // Supabase's documented Google ID-token nonce contract, identical in shape to
    // the Apple flow above: generate a cryptographically random RAW nonce, send
    // SHA-256(raw) as lowercase hex to the provider, and send the RAW value to
    // Supabase, which re-hashes and compares against the token's `nonce` claim.
    //
    // Both values come from one generation per login attempt — the raw nonce is
    // never derived from anything the provider returned.
    const rawNonce = generateRawNonce();
    const hashedNonce = await sha256Hex(rawNonce);

    // Pre-flight diagnostics (development only).
    //
    // Answers the question the nonce diagnostics below cannot: did the NATIVE
    // plugin handle this call, or did Capacitor fall back to the plugin's web
    // implementation? The web implementation generates its own nonce
    // (google-provider.js:44), so if it runs, the token's claim will not match
    // the nonce we supplied.
    if (process.env.NODE_ENV !== "production") {
      const capacitor = (globalThis as any)?.Capacitor;
      let platform = "unavailable";
      let nativePluginInvoked = false;
      try {
        platform = String(capacitor?.getPlatform?.() ?? "unavailable");
        // True only when the native bridge is present AND the SocialLogin plugin
        // is registered natively — i.e. the call will not fall through to web.
        nativePluginInvoked =
          capacitor?.isNativePlatform?.() === true && capacitor?.isPluginAvailable?.("SocialLogin") === true;
      } catch {
        // Diagnostics must never break sign-in.
      }

      console.log("[native-auth] Google login starting");
      console.log("[native-auth] Platform:", platform);
      console.log("[native-auth] Native plugin invoked:", nativePluginInvoked);
    }

    const user = await SocialLogin.login({
      provider: "google",
      options: {
        scopes: ["email", "profile"],
        // GoogleLoginOptions.nonce — forwarded by GoogleProvider.swift to
        // GIDSignIn, and used by the web implementation instead of the random
        // one it would otherwise invent.
        nonce: hashedNonce,
      },
    });
    // Documented shape: { provider: "google", result: GoogleLoginResponse }.
    // GoogleLoginResponse is a union — GoogleLoginResponseOnline has `idToken`,
    // GoogleLoginResponseOffline has only `serverAuthCode`. We initialize with
    // mode "online", so anything else means the plugin config drifted; say so
    // rather than reporting a generic "no token".
    const response = user?.result ?? {};
    if (response.responseType === "offline" || (!response.idToken && response.serverAuthCode)) {
      return {
        status: "error",
        message: "Google returned an authorization code instead of an ID token. The plugin must be initialized with mode \"online\".",
      };
    }

    const idToken: string | undefined = response.idToken ?? undefined;
    if (!idToken) {
      return { status: "error", message: "Google did not return an ID token. Please try again." };
    }

    // DEVELOPMENT DIAGNOSTICS ONLY.
    //
    // Decoding the returned token tells us whether the provider actually honoured
    // the nonce we supplied. It is never used as authentication input: the value
    // sent to Supabase below is always our own `rawNonce`.
    //
    // An earlier revision passed the decoded claim straight back to Supabase.
    // That satisfied Supabase's symmetry check but was circular — a token's own
    // nonce proves nothing about who requested it, so it provided no replay
    // protection. Only a nonce we generated and retained can do that.
    //
    // Logs booleans only: never the token, the raw nonce, or the hashed nonce.
    if (process.env.NODE_ENV !== "production") {
      const claimedNonce = readIdTokenNonce(idToken);
      console.log("[native-auth] Google ID token nonce claim present:", claimedNonce !== null);
      console.log("[native-auth] Google ID token nonce matches hashed nonce:", claimedNonce === hashedNonce);

      if (claimedNonce === null) {
        // The plugin dropped the nonce we supplied. Supabase will reject this
        // with "Passed nonce and nonce in id_token should either both exist or
        // not." We deliberately do NOT paper over it by omitting the nonce —
        // that would silently disable replay protection.
        console.warn(
          "[native-auth] Google returned a token with NO nonce claim despite one being supplied. " +
            "The native plugin did not forward it — check whether the plugin's web implementation " +
            "is running instead of the native iOS one (bridge unavailable).",
        );
      } else if (claimedNonce !== hashedNonce) {
        console.warn(
          "[native-auth] Google's nonce claim does not match the nonce supplied. " +
            "Something replaced it — likely the plugin's web implementation generating its own.",
        );
      }
    }

    const { error } = await supabase.auth.signInWithIdToken({
      provider: "google",
      token: idToken,
      // The RAW nonce. Supabase hashes this and compares against the token's
      // claim, which is SHA-256(rawNonce) because that is what we sent Google.
      nonce: rawNonce,
    });
    if (error) return { status: "error", message: error.message };

    const profile = response.profile ?? response;
    const fullName =
      buildFullName(profile?.givenName ?? profile?.given_name, profile?.familyName ?? profile?.family_name) ??
      (profile?.name ? String(profile.name).trim() || null : null);
    return { status: "success", provider: "google", fullName };
  } catch (err) {
    if (isUserCancelledError(err)) return { status: "cancelled" };
    return { status: "error", message: err instanceof Error ? err.message : "Google sign-in failed." };
  }
}
