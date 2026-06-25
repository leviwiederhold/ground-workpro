import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getCompanyBillingStatus } from "@/lib/billing/isCompanySubscriptionActive";
import { errorResponse } from "@/lib/http/errorResponse";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { okItem } from "@/lib/http/json";
import { serverError } from "@/lib/http/errors";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";

function isBillingStatusDebug(request: Request) {
  const url = new URL(request.url);
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.BILLING_STATUS_DEBUG === "true" ||
    url.searchParams.get("debug") === "1" ||
    request.headers.get("x-groundwork-debug") === "1"
  );
}

function getBillingStatusDenialReason(error: TenantResolverError) {
  const message = String(error.message ?? "").trim();
  if (error.status === 403 && /No company workspace found/i.test(message)) {
    return "TENANT_RESOLVER_NO_COMPANY_MEMBERSHIP";
  }
  if (error.status === 403) {
    return message || "TENANT_RESOLVER_FORBIDDEN";
  }
  return message || `TENANT_RESOLVER_STATUS_${error.status}`;
}

async function getBillingStatusDiagnostics(request: Request, reason: string) {
  const diagnostic = {
    requestUrl: request.url,
    userId: null as string | null,
    email: null as string | null,
    authSessionExists: false,
    profileExists: false,
    membershipExists: false,
    companyId: null as string | null,
    subscriptionStatus: null as string | null,
    reason,
  };

  try {
    const supabase = await supabaseServer();
    const sessionResult = await supabase.auth.getSession();
    diagnostic.authSessionExists = Boolean(sessionResult.data.session);

    const userResult = await supabase.auth.getUser();
    const user = userResult.data.user;
    diagnostic.userId = user?.id ?? null;
    diagnostic.email = String(user?.email ?? "").trim().toLowerCase() || null;

    if (!user?.id) {
      return diagnostic;
    }

    const diagnosticClient = getSupabaseAdmin() ?? supabase;
    const profileResult = await diagnosticClient
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();
    diagnostic.profileExists = Boolean(profileResult.data?.id);

    let membershipResult = await diagnosticClient
      .from("memberships")
      .select("company_id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (
      membershipResult.error &&
      /created_at|Could not find the 'created_at' column/i.test(membershipResult.error.message || "")
    ) {
      membershipResult = await diagnosticClient
        .from("memberships")
        .select("company_id")
        .eq("user_id", user.id)
        .order("company_id", { ascending: true })
        .limit(1)
        .maybeSingle();
    }

    diagnostic.membershipExists = Boolean(membershipResult.data?.company_id);
    diagnostic.companyId = String(membershipResult.data?.company_id ?? "").trim() || null;

    if (diagnostic.companyId) {
      const companyResult = await diagnosticClient
        .from("companies")
        .select("subscription_status")
        .eq("id", diagnostic.companyId)
        .maybeSingle();
      diagnostic.subscriptionStatus =
        String(companyResult.data?.subscription_status ?? "").trim().toLowerCase() || null;
    }
  } catch (diagnosticError) {
    console.warn("[billing/status] failed to collect diagnostics", {
      requestUrl: request.url,
      reason,
      diagnosticError: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError),
    });
  }

  return diagnostic;
}

async function logBillingStatusDenied(request: Request, reason: string) {
  const diagnostic = await getBillingStatusDiagnostics(request, reason);
  console.warn("[billing/status] 403 denied", diagnostic);
  return diagnostic;
}

export async function GET(request: Request) {
  const rateLimited = enforceRateLimit(request, {
    keyPrefix: "billing-status",
    limit: 120,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  try {
    const { supabase, companyId, userId } = await getCompanyId();
    console.log("[billing/status] userId:", userId, "companyId:", companyId);
    const status = await getCompanyBillingStatus(supabase, companyId);
    console.log("[billing/status] subscription_status:", status.subscription_status, "is_active:", status.is_active, "plan_type:", status.plan_type);

    return okItem(status);
  } catch (error) {
    if (error instanceof TenantResolverError) {
      if (error.status === 403) {
        const diagnostic = await logBillingStatusDenied(request, getBillingStatusDenialReason(error));
        if (isBillingStatusDebug(request)) {
          return NextResponse.json(
            { error: "forbidden", reason: diagnostic.reason, diagnostic },
            { status: 403 }
          );
        }
      }
      return errorResponse(error.message, error.status);
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return serverError(message);
  }
}
