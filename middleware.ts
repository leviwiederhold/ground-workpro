import type { NextRequest, NextFetchEvent } from "next/server";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { normalizeAppRole, ROUTE_GUARDS, type AppRole } from "@/lib/nav/config";
import { ACTING_ROLE_COOKIE, clampActingRole } from "@/lib/auth/effectiveRole";
import {
  applyPermissionOverrideFromCookie,
  hasModuleAccess,
  resolveUserModulePermissions,
  TEST_MODULE_ACCESS_COOKIE,
} from "@/lib/permissions/runtime";
import type { ModuleAccessLevel, ModulePermissionKey } from "@/lib/permissions/types";

const shouldLogRequests = process.env.REQUEST_LOGGING_ENABLED !== "false";
const REQUEST_ID_HEADER = "x-request-id";
const REQUEST_START_HEADER = "x-request-start";
const MIDDLEWARE_AUTH_TIMEOUT_MS = 1500;
const MIDDLEWARE_DB_TIMEOUT_MS = 1500;

class MiddlewareTimeoutError extends Error {
  constructor(label: string) {
    super(`${label} timed out`);
    this.name = "MiddlewareTimeoutError";
  }
}

function withMiddlewareTimeout<T>(label: string, promise: PromiseLike<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((_, reject) => {
      timeoutId = setTimeout(() => reject(new MiddlewareTimeoutError(label)), timeoutMs);
    }),
  ]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

function buildRequestId(request: NextRequest) {
  const existing = request.headers.get(REQUEST_ID_HEADER);
  if (existing && existing.trim().length > 0) return existing.trim();
  return crypto.randomUUID();
}

const API_MODULE_GUARDS: Array<{ prefix: string; module: ModulePermissionKey }> = [
  { prefix: "/api/jobs", module: "jobs" },
  { prefix: "/api/fleet", module: "fleet" },
  { prefix: "/api/equipment", module: "fleet" },
  { prefix: "/api/work-orders", module: "maintenance" },
  { prefix: "/api/maintenance", module: "maintenance" },
  { prefix: "/api/daily-reports", module: "daily_reports" },
  { prefix: "/api/safety", module: "safety" },
  { prefix: "/api/safety-logs", module: "safety" },
  { prefix: "/api/safety-actions", module: "safety" },
  { prefix: "/api/toolbox-talks", module: "safety" },
  { prefix: "/api/messages", module: "messages" },
  { prefix: "/api/finance", module: "finance" },
  { prefix: "/api/pricing-settings", module: "finance" },
  { prefix: "/api/team", module: "team_management" },
  { prefix: "/api/employees", module: "team_management" },
];

function findGuardedModule(
  pathname: string,
  guards: Array<{ prefix: string; module: ModulePermissionKey }>
) {
  return guards.find((entry) => pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`));
}

function resolveApiGuardedModule(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (
    request.method.toUpperCase() === "GET" &&
    pathname === "/api/equipment" &&
    request.nextUrl.searchParams.get("context") === "maintenance"
  ) {
    return { prefix: "/api/equipment", module: "maintenance" as ModulePermissionKey };
  }
  return findGuardedModule(pathname, API_MODULE_GUARDS);
}

// Pages that must bypass role guards — they handle auth themselves (e.g. post-Stripe
// redirect where membership may not exist yet).
const PAGE_GUARD_BYPASSES = new Set(["/settings/billing/success"]);

function findGuardedRoles(pathname: string): AppRole[] | null {
  if (PAGE_GUARD_BYPASSES.has(pathname)) return null;
  const entry = Object.entries(ROUTE_GUARDS)
    .sort((a, b) => b[0].length - a[0].length)
    .find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return entry?.[1] ?? null;
}

function shouldBypassApiModuleGuard(pathname: string, method: string): boolean {
  if (method.toUpperCase() === "GET" && /^\/api\/jobs\/[^/]+$/.test(pathname)) {
    return true;
  }
  return false;
}

function requiredAccessForApiMethod(method: string): ModuleAccessLevel {
  const normalized = method.toUpperCase();
  return normalized === "GET" || normalized === "HEAD" || normalized === "OPTIONS"
    ? "view"
    : "edit";
}

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  if (request.nextUrl.hostname === "www.groundwork-pro.com") {
    const canonicalUrl = request.nextUrl.clone();
    canonicalUrl.hostname = "groundwork-pro.com";
    return NextResponse.redirect(canonicalUrl, 308);
  }

  const requestId = buildRequestId(request);
  const requestStart = Date.now().toString();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  requestHeaders.set(REQUEST_START_HEADER, requestStart);

  let response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  const isApi = request.nextUrl.pathname.startsWith("/api/");
  const guardedPageRoles = !isApi ? findGuardedRoles(request.nextUrl.pathname) : null;
  const guardedApi =
    isApi && !shouldBypassApiModuleGuard(request.nextUrl.pathname, request.method)
      ? resolveApiGuardedModule(request)
      : null;
  const guardedModule = guardedApi?.module ?? null;

  if (!guardedPageRoles && !guardedModule) {
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

  const { url, anonKey } = getSupabaseEnv();

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
  let authData: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"] | null = null;
  try {
    authData = (
      await withMiddlewareTimeout(
        "middleware auth",
        supabase.auth.getUser(),
        MIDDLEWARE_AUTH_TIMEOUT_MS
      )
    ).data;
  } catch {
    if (!isApi) return NextResponse.redirect(new URL("/login", request.url));
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (guardedPageRoles || guardedModule) {
    try {
      const cookieRole =
        process.env.NODE_ENV !== "production" || process.env.E2E === "true"
          ? request.cookies.get("e2e_role")?.value
          : null;
      let resolvedRole = normalizeAppRole(cookieRole);
      let companyId: string | null = null;
      const userId: string | null = authData?.user?.id ?? null;
      let permissions: Awaited<ReturnType<typeof resolveUserModulePermissions>> | null = null;

      if (!resolvedRole) {
        if (!userId) {
          if (!isApi) return NextResponse.redirect(new URL("/login", request.url));
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        // Resolve the user's OWN membership with the service-role client so a
        // memberships RLS SELECT gap can't make a valid member (CEO/co-CEO)
        // unreadable → a blanket 403 on every guarded API. Scoped to this user
        // id, so no cross-tenant exposure. Falls back to the RLS client.
        const membershipClient = getSupabaseAdmin() ?? supabase;
        const { data: memberships, error: membershipError } = await withMiddlewareTimeout(
          "middleware membership lookup",
          membershipClient
            .from("memberships")
            .select("company_id, role")
            .eq("user_id", userId)
            .limit(1),
          MIDDLEWARE_DB_TIMEOUT_MS
        );

        if (membershipError) {
          if (!isApi) return NextResponse.redirect(new URL("/", request.url));
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        companyId = String(memberships?.[0]?.company_id ?? "");
        const realRole = normalizeAppRole(memberships?.[0]?.role);
        if (!realRole) {
          if (!isApi) return NextResponse.redirect(new URL("/", request.url));
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const actingRole = normalizeAppRole(request.cookies.get(ACTING_ROLE_COOKIE)?.value);
        resolvedRole = actingRole ? clampActingRole(realRole, actingRole) : realRole;
      } else if (userId) {
        const companyLookupClient = getSupabaseAdmin() ?? supabase;
        const { data: memberships } = await withMiddlewareTimeout(
          "middleware company lookup",
          companyLookupClient
            .from("memberships")
            .select("company_id")
            .eq("user_id", userId)
            .limit(1),
          MIDDLEWARE_DB_TIMEOUT_MS
        );
        companyId = String(memberships?.[0]?.company_id ?? "");
      }

      if (!resolvedRole || !userId || !companyId) {
        // TEMP diagnostic for the 403 storm investigation.
        if (process.env.NODE_ENV !== "production") {
          console.warn("[middleware] 403", {
            route: request.nextUrl.pathname,
            userId,
            membershipFound: Boolean(companyId),
            companyId: companyId || null,
            role: resolvedRole || null,
            reason: !userId ? "no_user" : !companyId ? "no_company_membership" : "no_role",
          });
        }
        if (!isApi) return NextResponse.redirect(new URL("/", request.url));
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      if (guardedPageRoles && !guardedPageRoles.includes(resolvedRole)) {
        // Deny direct access to a guarded page route for roles that lack it.
        // Return a 403 (not a 200 access-denied rewrite) so a denied role truly
        // cannot reach the page — the in-app SPA still shows its own "Access
        // Restricted" state for client-side view switches.
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      if (guardedModule) {
        permissions = await withMiddlewareTimeout(
          "middleware permissions lookup",
          resolveUserModulePermissions({
            supabase,
            companyId,
            userId,
            role: resolvedRole,
          }),
          MIDDLEWARE_DB_TIMEOUT_MS
        );
        if (process.env.NODE_ENV !== "production" || process.env.E2E === "true") {
          permissions = applyPermissionOverrideFromCookie(
            permissions,
            request.cookies.get(TEST_MODULE_ACCESS_COOKIE)?.value
          );
        }

        const required = guardedApi ? requiredAccessForApiMethod(request.method) : "view";
        if (!hasModuleAccess(permissions, guardedModule, required)) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
      }
    } catch {
      if (!isApi) return NextResponse.redirect(new URL("/", request.url));
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
    // Run middleware ONLY where auth may be needed. Exclude Next internals,
    // Vercel internals, static assets, fonts, and common public files so no
    // auth/session work is triggered on non-protected requests (avoids adding
    // load to Supabase Auth). Protected pages and /api/* still match; the
    // handler itself short-circuits any non-guarded path before touching auth.
    "/((?!_next/static|_next/image|_next/data|_vercel|favicon.ico|robots.txt|sitemap.xml|manifest.webmanifest|apple-touch-icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff|woff2|ttf|otf|eot|css|js|map|txt|xml|json)$).*)",
  ],
};
