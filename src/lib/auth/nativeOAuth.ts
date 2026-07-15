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

// The app's iOS bundle identifier (must match capacitor.config.ts `appId` and
// the Apple "Sign in with Apple" App ID / Supabase authorized client id).
export const IOS_BUNDLE_ID = "com.groundworkpro.app";
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

// Post-authentication route decision — the SAME rule the native email/password
// path already uses, extracted so email, Apple, and Google all route
// identically. An invited user ALWAYS goes through invite acceptance and is
// therefore NEVER sent through company bootstrap (safeguard: invited employees
// can't create a company).
export type PostAuthRoute = "accept-invite" | "dashboard" | "no-workspace";

export function resolvePostAuthRoute(params: { isInvite: boolean; hasWorkspace: boolean }): PostAuthRoute {
  if (params.isInvite) return "accept-invite";
  return params.hasWorkspace ? "dashboard" : "no-workspace";
}

// ---------------------------------------------------------------------------
// Runtime flows (native only) — thin glue over the plugins + Supabase.
// ---------------------------------------------------------------------------

export async function signInWithAppleNative(supabase: SupabaseClient): Promise<NativeSignInResult> {
  try {
    const rawNonce = generateRawNonce();
    const hashedNonce = await sha256Hex(rawNonce);

    const { SocialLogin } = (await import("@capgo/capacitor-social-login")) as any;
    await SocialLogin.initialize({
      apple: { clientId: IOS_BUNDLE_ID },
    });

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
    const iOSClientId = process.env.NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID;
    const webClientId = process.env.NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    if (!iOSClientId || !webClientId) {
      return {
        status: "error",
        message: "Google sign-in is not configured for this app build.",
      };
    }

    const { SocialLogin } = (await import("@capgo/capacitor-social-login")) as any;
    await SocialLogin.initialize({
      google: {
        iOSClientId,
        iOSServerClientId: webClientId,
        webClientId,
        mode: "online",
      },
    });

    const user = await SocialLogin.login({
      provider: "google",
      options: {
        scopes: ["email", "profile"],
      },
    });
    const response = user?.result ?? {};
    const idToken: string | undefined = response.idToken ?? response.authentication?.idToken;
    if (!idToken) {
      return { status: "error", message: "Google did not return an ID token. Please try again." };
    }

    const { error } = await supabase.auth.signInWithIdToken({ provider: "google", token: idToken });
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
