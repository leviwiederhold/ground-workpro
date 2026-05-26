import { getStripe, getStripePriceId, isStripeConfigured } from "@/lib/billing/stripe";
import { errorResponse } from "@/lib/http/errorResponse";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";

export const runtime = "nodejs";

const FALLBACK_SITE_URL = "https://ground-workpro.vercel.app";
const INVALID_CHECKOUT_HOSTS = new Set(["groundwork-pro.com", "www.groundwork-pro.com"]);

function normalizeConfiguredOrigin(value: string | undefined) {
  const trimmed = value?.trim().replace(/\/$/, "");
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (INVALID_CHECKOUT_HOSTS.has(parsed.hostname)) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function getOrigin() {
  const configuredUrls = [process.env.NEXT_PUBLIC_SITE_URL, process.env.NEXT_PUBLIC_APP_URL];
  for (const configuredUrl of configuredUrls) {
    const configuredOrigin = normalizeConfiguredOrigin(configuredUrl);
    if (configuredOrigin) return configuredOrigin;
  }

  console.warn(
    `Invalid or missing checkout site URL (${configuredUrls.filter(Boolean).join(", ") || "unset"}). Falling back to ${FALLBACK_SITE_URL}.`
  );

  return FALLBACK_SITE_URL;
}

function isNativePurchaseAttempt(request: Request) {
  const nativeHeader = request.headers.get("x-groundwork-native");
  const platformHeader = request.headers.get("x-groundwork-platform");
  const userAgent = request.headers.get("user-agent") ?? "";

  return (
    nativeHeader === "1" ||
    String(platformHeader ?? "").toLowerCase() === "ios" ||
    /Capacitor|GroundworkProNative/i.test(userAgent)
  );
}

export async function POST(request: Request) {
  const rateLimited = enforceRateLimit(request, {
    keyPrefix: "billing-checkout",
    limit: 60,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  try {
    if (isNativePurchaseAttempt(request)) {
      return errorResponse("Subscription checkout is available on the Groundwork Pro website.", 403);
    }

    if (!isStripeConfigured()) {
      return errorResponse("Stripe not configured", 501);
    }

    const stripe = getStripe();
    const origin = getOrigin();
    const { supabase, companyId, userEmail } = await getCompanyId();
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("name, stripe_customer_id")
      .eq("id", companyId)
      .maybeSingle();

    if (companyError) {
      return errorResponse(companyError.message, 400);
    }

    let customerId = String(company?.stripe_customer_id ?? "").trim();
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userEmail || undefined,
        name: String(company?.name ?? "").trim() || undefined,
        metadata: {
          company_id: companyId,
        },
      });
      customerId = customer.id;

      const customerUpdate = await supabase
        .from("companies")
        .update({ stripe_customer_id: customerId })
        .eq("id", companyId);
      if (customerUpdate.error) {
        return errorResponse(customerUpdate.error.message, 400);
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      payment_method_collection: "always",
      line_items: [{ price: getStripePriceId(), quantity: 1 }],
      subscription_data: {
        trial_period_days: 7,
        metadata: {
          company_id: companyId,
        },
      },
      metadata: {
        company_id: companyId,
        signup_flow: "authenticated_trial",
      },
      success_url: `${origin}/settings/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/pricing`,
    });

    return Response.json({ url: session.url });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse("Internal server error", 500);
  }
}
