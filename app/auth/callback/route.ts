import { NextRequest, NextResponse } from "next/server";
import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseEnv } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

function buildRedirectUrl(request: NextRequest, pathname: string) {
  return new URL(pathname, request.nextUrl.origin);
}

/**
 * Restrict post-callback redirects to internal, absolute paths so a crafted
 * `next` can't turn the callback into an open redirect. Protocol-relative
 * (`//host`) and absolute URLs are rejected.
 */
function safeNextPath(raw: string | null): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

/**
 * When a recovery link is bad (missing/expired/already-used code), send the
 * user back to the reset page with a recovery-specific error instead of the
 * generic login error, so they see a clear "request a new link" message.
 */
function recoveryError(request: NextRequest, nextPath: string) {
  const target = buildRedirectUrl(request, nextPath);
  target.searchParams.set("error", "recovery_link_invalid");
  return NextResponse.redirect(target);
}

function buildCookieHeader(
  request: NextRequest,
  cookiesToSet: Array<{ name: string; value: string }>
) {
  const merged = new Map<string, string>();
  request.cookies.getAll().forEach((cookie) => {
    merged.set(cookie.name, cookie.value);
  });
  cookiesToSet.forEach((cookie) => {
    merged.set(cookie.name, cookie.value);
  });
  return Array.from(merged.entries())
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join("; ");
}

export async function GET(request: NextRequest) {
  // Recovery emails route through here with `next=/reset-password`. When set,
  // failures return to the reset page with a recovery error rather than /login.
  const nextPath = safeNextPath(request.nextUrl.searchParams.get("next"));

  const providerError =
    request.nextUrl.searchParams.get("error_description") ||
    request.nextUrl.searchParams.get("error");
  if (providerError) {
    if (nextPath) return recoveryError(request, nextPath);
    const loginUrl = buildRedirectUrl(request, "/login");
    loginUrl.searchParams.set("error", "oauth_failed");
    return NextResponse.redirect(loginUrl);
  }

  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    if (nextPath) return recoveryError(request, nextPath);
    return NextResponse.redirect(buildRedirectUrl(request, "/login"));
  }

  const { url, anonKey } = getSupabaseEnv();
  const authCookiesToSet: Array<{ name: string; value: string; options?: Partial<ResponseCookie> }> = [];
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(nextCookies) {
        nextCookies.forEach((cookie) => {
          const { name, value } = cookie;
          request.cookies.set(name, value);
          authCookiesToSet.push(cookie);
        });
      },
    },
  });

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    if (nextPath) return recoveryError(request, nextPath);
    const loginUrl = buildRedirectUrl(request, "/login");
    loginUrl.searchParams.set("error", "oauth_exchange_failed");
    return NextResponse.redirect(loginUrl);
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    if (nextPath) return recoveryError(request, nextPath);
    const loginUrl = buildRedirectUrl(request, "/login");
    loginUrl.searchParams.set("error", "oauth_session_missing");
    return NextResponse.redirect(loginUrl);
  }

  // Recovery flow: session cookies are now set from the exchange above. Land the
  // user on the reset page (via `next`) with those cookies attached so the
  // update-password call is authenticated. No invite handling for recovery.
  if (nextPath) {
    const response = NextResponse.redirect(buildRedirectUrl(request, nextPath));
    authCookiesToSet.forEach(({ name, value, options }) => {
      response.cookies.set(name, value, options);
    });
    return response;
  }

  const invite = request.nextUrl.searchParams.get("invite") === "1";
  const token = request.nextUrl.searchParams.get("token");
  const join = request.nextUrl.searchParams.get("join") === "1";
  const joinCode = request.nextUrl.searchParams.get("code");
  if (invite && token) {
    const acceptResponse = await fetch(new URL("/api/invite/accept", request.nextUrl.origin), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: buildCookieHeader(request, authCookiesToSet),
      },
      body: JSON.stringify({ token }),
      cache: "no-store",
    }).catch(() => null);

    if (!acceptResponse?.ok) {
      const signupUrl = buildRedirectUrl(request, "/signup");
      signupUrl.searchParams.set("invite", "1");
      signupUrl.searchParams.set("token", token);
      signupUrl.searchParams.set("error", "invite_accept_failed");
      const response = NextResponse.redirect(signupUrl);
      authCookiesToSet.forEach(({ name, value, options }) => {
        response.cookies.set(name, value, options);
      });
      return response;
    }
  }

  if (join && joinCode) {
    const acceptResponse = await fetch(new URL("/api/join/accept", request.nextUrl.origin), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: buildCookieHeader(request, authCookiesToSet),
      },
      body: JSON.stringify({ code: joinCode }),
      cache: "no-store",
    }).catch(() => null);

    if (!acceptResponse?.ok) {
      const signupUrl = buildRedirectUrl(request, "/signup");
      signupUrl.searchParams.set("join", "1");
      signupUrl.searchParams.set("code", joinCode);
      signupUrl.searchParams.set("error", "join_accept_failed");
      const response = NextResponse.redirect(signupUrl);
      authCookiesToSet.forEach(({ name, value, options }) => {
        response.cookies.set(name, value, options);
      });
      return response;
    }
  }

  const redirectUrl = buildRedirectUrl(request, "/");
  if (invite && token) {
    redirectUrl.searchParams.set("invite", "1");
    redirectUrl.searchParams.set("token", token);
  }
  if (join && joinCode) {
    redirectUrl.searchParams.set("join", "1");
  }

  const response = NextResponse.redirect(redirectUrl);
  authCookiesToSet.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options);
  });

  return response;
}
