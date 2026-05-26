import { getStripe } from "@/lib/billing/stripe";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import Stripe from "stripe";

export const runtime = "nodejs";

const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
]);

type CompanyBillingUpdate = {
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  subscription_status?: string;
  plan_type?: string;
  trial_ends_at?: string | null;
  current_period_end?: string | null;
};

function unixToIso(value: number | null | undefined) {
  return typeof value === "number" ? new Date(value * 1000).toISOString() : null;
}

function idFromStripeRef(value: string | { id?: string } | null | undefined) {
  if (!value) return "";
  return typeof value === "string" ? value : String(value.id ?? "");
}

async function updateCompanySubscription(subscription: Stripe.Subscription) {
  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }

  const companyId = String(subscription.metadata?.company_id ?? "").trim();
  const customerId = idFromStripeRef(subscription.customer);
  const update: CompanyBillingUpdate = {
    stripe_customer_id: customerId || undefined,
    stripe_subscription_id: subscription.id,
    subscription_status: subscription.status,
    plan_type: "groundwork_pro",
    trial_ends_at: unixToIso(subscription.trial_end),
    current_period_end: unixToIso(subscription.items.data[0]?.current_period_end),
  };

  const query = admin.from("companies").update(update);
  const result = companyId
    ? await query.eq("id", companyId)
    : await query.eq("stripe_subscription_id", subscription.id);

  if (result.error) {
    throw new Error(result.error.message);
  }
}

async function updateCheckoutSession(session: Stripe.Checkout.Session) {
  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }

  const companyId = String(session.metadata?.company_id ?? "").trim();
  const subscriptionId = idFromStripeRef(session.subscription);
  const customerId = idFromStripeRef(session.customer);

  if (!companyId) return;

  const update: CompanyBillingUpdate = {
    stripe_customer_id: customerId || undefined,
    stripe_subscription_id: subscriptionId || undefined,
  };

  if (subscriptionId) {
    const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
    update.subscription_status = subscription.status;
    update.plan_type = "groundwork_pro";
    update.trial_ends_at = unixToIso(subscription.trial_end);
    update.current_period_end = unixToIso(subscription.items.data[0]?.current_period_end);
  }

  const result = await admin.from("companies").update(update).eq("id", companyId);
  if (result.error) {
    throw new Error(result.error.message);
  }
}

async function updateInvoiceSubscription(invoice: Stripe.Invoice) {
  const subscriptionId = idFromStripeRef(
    (invoice as Stripe.Invoice & { subscription?: string | Stripe.Subscription | null }).subscription
  );

  if (!subscriptionId) return;

  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
  await updateCompanySubscription(subscription);
}

export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");

  if (!webhookSecret || !signature) {
    return NextResponse.json({ error: "Stripe webhook is not configured" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(await request.text(), signature, webhookSecret);
  } catch {
    return NextResponse.json({ error: "Invalid Stripe signature" }, { status: 400 });
  }

  if (!HANDLED_EVENTS.has(event.type)) {
    return NextResponse.json({ received: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await updateCheckoutSession(event.data.object as Stripe.Checkout.Session);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await updateCompanySubscription(event.data.object as Stripe.Subscription);
        break;
      case "invoice.payment_succeeded":
      case "invoice.payment_failed":
        await updateInvoiceSubscription(event.data.object as Stripe.Invoice);
        break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process Stripe webhook";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
