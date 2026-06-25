import { getStripe, getStripePriceId, isStripeConfigured } from "@/lib/billing/stripe";
import { errorResponse } from "@/lib/http/errorResponse";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";

export const runtime = "nodejs";

const CANONICAL_SITE_URL = "https://groundwork-pro.com";
const FALLBACK_SITE_URL = CANONICAL_SITE_URL;
// Hosts that must never be used for checkout redirect URLs (e.g. domains that
// are not yet live). The production apex (groundwork-pro.com / www) is live and
// is now allowed so success_url/cancel_url can use the real domain.
const INVALID_CHECKOUT_HOSTS = new Set<string>([]);

function normalizeConfiguredOrigin(value: string | undefined) {
  const trimmed = value?.trim().replace(/\/$/, "");
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (INVALID_CHECKOUT_HOSTS.has(parsed.hostname)) return null;
    if (parsed.hostname === "www.groundwork-pro.com" || parsed.hostname === "groundwork-pro.com") {
      return CANONICAL_SITE_URL;
    }
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

const isDev = process.env.NODE_ENV !== "production";

/** "test" | "live" | "unknown" from the secret key prefix — no secret leaked. */
function stripeKeyMode(): string {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (key.startsWith("sk_test") || key.startsWith("rk_test")) return "test";
  if (key.startsWith("sk_live") || key.startsWith("rk_live")) return "live";
  return "unknown";
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

    // Config visibility — booleans / mode only, never secret values.
    console.log("[billing/checkout] config", {
      has_secret_key: Boolean(process.env.STRIPE_SECRET_KEY?.trim()),
      stripe_key_mode: stripeKeyMode(),
      has_price_id: Boolean(process.env.STRIPE_PRICE_ID?.trim()),
      has_site_url: Boolean(
        process.env.NEXT_PUBLIC_SITE_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim()
      ),
    });

    if (!isStripeConfigured()) {
      console.error(
        "[billing/checkout] not configured — STRIPE_SECRET_KEY / STRIPE_PRICE_ID missing in this environment."
      );
      return errorResponse("Billing is not configured", 501);
    }

    const stripe = getStripe();
    const priceId = getStripePriceId();
    const origin = getOrigin();
    console.log("[billing/checkout] resolved origin:", origin);

    const { supabase, companyId, userEmail, userId } = await getCompanyId();
    console.log("[billing/checkout] tenant", {
      has_user: Boolean(userId),
      has_company: Boolean(companyId),
    });

    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("name, stripe_customer_id")
      .eq("id", companyId)
      .maybeSingle();

    if (companyError) {
      console.error("[billing/checkout] company lookup failed:", companyError.message);
      return errorResponse(companyError.message, 400);
    }

    let customerId = String(company?.stripe_customer_id ?? "").trim();
    if (!customerId) {
      console.log("[billing/checkout] creating Stripe customer for company", companyId);
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
        console.error("[billing/checkout] failed to persist stripe_customer_id:", customerUpdate.error.message);
        return errorResponse(customerUpdate.error.message, 400);
      }
    }

    console.log("[billing/checkout] creating session", {
      customer: customerId,
      price: priceId,
      key_mode: stripeKeyMode(),
    });
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      payment_method_collection: "always",
      line_items: [{ price: priceId, quantity: 1 }],
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

    console.log("[billing/checkout] session created:", session.id);
    return Response.json({ url: session.url });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      // Missing/invalid auth or company → clear 401/403/4xx from the resolver.
      console.warn("[billing/checkout] tenant error:", error.status, error.message);
      return errorResponse(error.message, error.status);
    }

    // Stripe errors carry safe, structured fields. Log them server-side; a
    // test/live price mismatch surfaces here as "No such price: …".
    const err = error as { type?: string; code?: string; statusCode?: number; message?: string };
    console.error("[billing/checkout] checkout failed", {
      type: err?.type,
      code: err?.code,
      statusCode: err?.statusCode,
      key_mode: stripeKeyMode(),
      message: err?.message,
    });

    const isStripeError = typeof err?.type === "string" && err.type.startsWith("Stripe");
    const safeMessage = isStripeError
      ? "Unable to start checkout. Please try again or contact support."
      : "Internal server error";

    // In development, surface the underlying message to speed debugging.
    return errorResponse(isDev && err?.message ? err.message : safeMessage, 500);
  }
}
