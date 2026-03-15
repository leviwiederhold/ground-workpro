import type { NextRequest, NextFetchEvent } from "next/server";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { normalizeAppRole } from "@/lib/nav/config";
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

function buildRequestId(request: NextRequest) {
  const existing = request.headers.get(REQUEST_ID_HEADER);
  if (existing && existing.trim().length > 0) return existing.trim();
  return crypto.randomUUID();
}

const PAGE_MODULE_GUARDS: Array<{ prefix: string; module: ModulePermissionKey }> = [
  { prefix: "/jobs", module: "jobs" },
  { prefix: "/fleet", module: "fleet" },
  { prefix: "/maintenance", module: "maintenance" },
  { prefix: "/reports", module: "daily_reports" },
  { prefix: "/safety", module: "safety" },
  { prefix: "/messages", module: "messages" },
  { prefix: "/finance", module: "finance" },
  { prefix: "/team", module: "team_management" },
];

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

function requiredAccessForApiMethod(method: string): ModuleAccessLevel {
  const normalized = method.toUpperCase();
  return normalized === "GET" || normalized === "HEAD" || normalized === "OPTIONS"
    ? "view"
    : "edit";
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

  const isApi = request.nextUrl.pathname.startsWith("/api/");
  const guardedPage = !isApi ? findGuardedModule(request.nextUrl.pathname, PAGE_MODULE_GUARDS) : null;
  const guardedApi = isApi ? findGuardedModule(request.nextUrl.pathname, API_MODULE_GUARDS) : null;
  const guardedModule = guardedPage?.module ?? guardedApi?.module ?? null;

  if (guardedModule) {
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
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const { data: memberships, error: membershipError } = await supabase
          .from("memberships")
          .select("company_id, role")
          .eq("user_id", userId)
          .limit(1);

        if (membershipError) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        companyId = String(memberships?.[0]?.company_id ?? "");
        const realRole = normalizeAppRole(memberships?.[0]?.role);
        if (!realRole) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const actingRole = normalizeAppRole(request.cookies.get(ACTING_ROLE_COOKIE)?.value);
        resolvedRole = actingRole ? clampActingRole(realRole, actingRole) : realRole;
      } else if (userId) {
        const { data: memberships } = await supabase
          .from("memberships")
          .select("company_id")
          .eq("user_id", userId)
          .limit(1);
        companyId = String(memberships?.[0]?.company_id ?? "");
      }

      if (!resolvedRole || !userId || !companyId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      permissions = await resolveUserModulePermissions({
        supabase,
        companyId,
        userId,
        role: resolvedRole,
      });
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
