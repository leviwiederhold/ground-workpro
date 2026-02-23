import type { NextRequest, NextFetchEvent } from "next/server";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { normalizeAppRole, ROUTE_GUARDS } from "@/lib/nav/config";
import { ACTING_ROLE_COOKIE, clampActingRole } from "@/lib/auth/effectiveRole";

const shouldLogRequests = process.env.REQUEST_LOGGING_ENABLED !== "false";
const REQUEST_ID_HEADER = "x-request-id";
const REQUEST_START_HEADER = "x-request-start";

function buildRequestId(request: NextRequest) {
  const existing = request.headers.get(REQUEST_ID_HEADER);
  if (existing && existing.trim().length > 0) return existing.trim();
  return crypto.randomUUID();
}

function findGuardedPrefix(pathname: string) {
  const prefixes = Object.keys(ROUTE_GUARDS);
  return prefixes.find((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  const { url, anonKey } = getSupabaseEnv();

  const requestId = buildRequestId(request);
  const requestStart = Date.now().toString();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  requestHeaders.set(REQUEST_START_HEADER, requestStart);

  let response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({
          request: { headers: requestHeaders },
        });

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  // Required for Supabase SSR auth cookie refresh.
  const { data: authData } = await supabase.auth.getUser();

  if (!request.nextUrl.pathname.startsWith("/api/")) {
    const guardedPrefix = findGuardedPrefix(request.nextUrl.pathname);
    if (guardedPrefix) {
      const cookieRole = process.env.NODE_ENV !== "production" ? request.cookies.get("e2e_role")?.value : null;
      let resolvedRole = normalizeAppRole(cookieRole);

      if (!resolvedRole) {
        const userId = authData?.user?.id ?? null;
        if (!userId) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const { data: memberships, error: membershipError } = await supabase
          .from("memberships")
          .select("role")
          .eq("user_id", userId)
          .limit(1);

        if (membershipError) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const realRole = normalizeAppRole(memberships?.[0]?.role);
        if (!realRole) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const actingRole = normalizeAppRole(request.cookies.get(ACTING_ROLE_COOKIE)?.value);
        resolvedRole = actingRole ? clampActingRole(realRole, actingRole) : realRole;
      }

      const allowedRoles = ROUTE_GUARDS[guardedPrefix] ?? [];
      if (!resolvedRole || !allowedRoles.includes(resolvedRole)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
  }

  response.headers.set(REQUEST_ID_HEADER, requestId);

  if (shouldLogRequests && request.nextUrl.pathname.startsWith("/api/")) {
    const method = request.method;
    const path = request.nextUrl.pathname;
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "unknown";

    event.waitUntil(
      Promise.resolve().then(() => {
        console.info(
          JSON.stringify({
            ts: new Date().toISOString(),
            level: "info",
            event: "api_request",
            request_id: requestId,
            method,
            path,
            ip,
          })
        );
      })
    );
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
