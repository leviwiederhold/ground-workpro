import { NextRequest, NextResponse } from "next/server";
import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseEnv } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

function buildRedirectUrl(request: NextRequest, pathname: string) {
  return new URL(pathname, request.nextUrl.origin);
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
  const providerError =
    request.nextUrl.searchParams.get("error_description") ||
    request.nextUrl.searchParams.get("error");
  if (providerError) {
    const loginUrl = buildRedirectUrl(request, "/login");
    loginUrl.searchParams.set("error", "oauth_failed");
    return NextResponse.redirect(loginUrl);
  }

  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
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
    const loginUrl = buildRedirectUrl(request, "/login");
    loginUrl.searchParams.set("error", "oauth_exchange_failed");
    return NextResponse.redirect(loginUrl);
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    const loginUrl = buildRedirectUrl(request, "/login");
    loginUrl.searchParams.set("error", "oauth_session_missing");
    return NextResponse.redirect(loginUrl);
  }

  const invite = request.nextUrl.searchParams.get("invite") === "1";
  const token = request.nextUrl.searchParams.get("token");
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
      const loginUrl = buildRedirectUrl(request, "/login");
      loginUrl.searchParams.set("error", "invite_accept_failed");
      const response = NextResponse.redirect(loginUrl);
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

  const response = NextResponse.redirect(redirectUrl);
  authCookiesToSet.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options);
  });

  return response;
}
