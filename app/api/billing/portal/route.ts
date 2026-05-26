import { requireRole } from "@/lib/auth/requireRole";
import { isBillingEnabled } from "@/lib/billing/isBillingEnabled";
import { getStripe, isStripeConfigured } from "@/lib/billing/stripe";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { errorResponse } from "@/lib/http/errorResponse";
import { enforceRateLimit } from "@/lib/http/rateLimit";

function isNativeRequest(request: Request): boolean {
  const nativeHeader = request.headers.get("x-groundwork-native");
  const platformHeader = request.headers.get("x-groundwork-platform");
  const userAgent = request.headers.get("user-agent") ?? "";
  return (
    nativeHeader === "1" ||
    String(platformHeader ?? "").toLowerCase() === "ios" ||
    /Capacitor|GroundworkProNative/i.test(userAgent)
  );
}

export const runtime = "nodejs";

const FALLBACK_SITE_URL = "https://ground-workpro.vercel.app";

function getReturnUrl(request: Request): string {
  try {
    const origin = new URL(request.url).origin;
    return `${origin}/settings/billing`;
  } catch {
    return `${process.env.NEXT_PUBLIC_SITE_URL ?? FALLBACK_SITE_URL}/settings/billing`;
  }
}

export async function POST(request: Request) {
  const rateLimited = enforceRateLimit(request, {
    keyPrefix: "billing-portal",
    limit: 20,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  try {
    // Native iOS app must not access Stripe portal per App Store guidelines.
    if (isNativeRequest(request)) {
      return errorResponse("Billing portal is not available in the native app", 403);
    }

    try {
      await requireRole(["admin"]);
    } catch {
      return errorResponse("Forbidden", 403);
    }

    if (!isBillingEnabled()) {
      return errorResponse("Billing not enabled", 501);
    }

    if (!isStripeConfigured()) {
      return errorResponse("Stripe not configured", 501);
    }

    const { companyId } = await getCompanyId();

    // Look up the Stripe customer ID from the companies table.
    const admin = getSupabaseAdmin();
    const client = admin;
    if (!client) {
      return errorResponse("Server configuration error", 500);
    }

    const { data, error } = await client
      .from("companies")
      .select("stripe_customer_id")
      .eq("id", companyId)
      .maybeSingle();

    if (error) {
      console.error("[billing/portal] DB lookup failed:", error.message);
      return errorResponse("Failed to load billing information", 500);
    }

    const customerId = typeof data?.stripe_customer_id === "string"
      ? data.stripe_customer_id.trim()
      : "";

    if (!customerId) {
      return errorResponse(
        "No Stripe customer found for this company. Complete a checkout first.",
        400
      );
    }

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: getReturnUrl(request),
    });

    return Response.json({ ok: true, url: session.url });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return errorResponse(error.message, error.status);
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[billing/portal] Unexpected error:", message);
    return errorResponse(message, 500);
  }
}
