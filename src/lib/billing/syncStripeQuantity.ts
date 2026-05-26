import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getStripe, isStripeConfigured } from "@/lib/billing/stripe";
import { getActiveBillableSeatCount } from "@/lib/billing/seatCount";

type SyncResult =
  | { synced: true; quantity: number }
  | { synced: false; reason: string };

/**
 * Recalculates the active billable seat count for a company and updates the
 * Stripe subscription item quantity to match.
 *
 * This is called after:
 *   - An employee accepts an invite (seat count goes up)
 *   - An employee is deactivated or deleted (seat count goes down)
 *
 * It is intentionally fire-and-forget friendly — callers should log the result
 * but must NOT silently swallow errors that represent actual billing failures.
 */
export async function syncStripeQuantityForCompany(companyId: string): Promise<SyncResult> {
  if (!isStripeConfigured()) {
    return { synced: false, reason: "stripe_not_configured" };
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return { synced: false, reason: "admin_not_configured" };
  }

  // Look up the company's Stripe subscription ID.
  const { data: company, error: companyError } = await admin
    .from("companies")
    .select("stripe_subscription_id")
    .eq("id", companyId)
    .maybeSingle();

  if (companyError) {
    console.error("[syncStripeQuantity] DB lookup failed:", companyError.message);
    return { synced: false, reason: "db_error" };
  }

  const subscriptionId = typeof company?.stripe_subscription_id === "string"
    ? company.stripe_subscription_id.trim()
    : "";

  if (!subscriptionId) {
    // Company hasn't completed checkout yet — nothing to sync.
    return { synced: false, reason: "no_subscription_id" };
  }

  // Calculate the current active seat count.
  let seatCount: number;
  try {
    seatCount = await getActiveBillableSeatCount(companyId);
  } catch (err) {
    console.error("[syncStripeQuantity] seat count failed:", err instanceof Error ? err.message : err);
    return { synced: false, reason: "seat_count_error" };
  }

  // Retrieve the Stripe subscription and find the correct subscription item.
  try {
    const stripe = getStripe();
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);

    if (subscription.status === "canceled") {
      return { synced: false, reason: "subscription_canceled" };
    }

    const priceId = process.env.STRIPE_PRICE_ID?.trim();
    const item =
      (priceId ? subscription.items.data.find((i) => i.price.id === priceId) : null) ??
      subscription.items.data[0];

    if (!item) {
      console.error("[syncStripeQuantity] No subscription item found for sub:", subscriptionId);
      return { synced: false, reason: "no_subscription_item" };
    }

    await stripe.subscriptionItems.update(item.id, { quantity: seatCount });

    console.log(
      `[syncStripeQuantity] company=${companyId} seats=${seatCount} item=${item.id} sub=${subscriptionId}`
    );

    return { synced: true, quantity: seatCount };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[syncStripeQuantity] Stripe update failed:", message);
    // Re-throw so callers can surface a meaningful error to CEO/admin on web.
    throw new Error(`Failed to update subscription quantity: ${message}`);
  }
}
