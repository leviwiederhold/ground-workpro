import { requireRole } from "@/lib/auth/requireRole";
import { redirect } from "next/navigation";
import { isBillingEnabled } from "@/lib/billing/isBillingEnabled";
import { isStripeConfigured } from "@/lib/billing/isStripeConfigured";

export default async function BillingSettingsPage() {
  try {
    await requireRole(["admin"]);
  } catch {
    redirect("/");
  }

  const billingEnabled = isBillingEnabled();
  const stripeConfigured = isStripeConfigured();

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-2xl rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-gray-900">Billing</h1>

        {!billingEnabled ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4 text-amber-900">
            <p className="font-medium">Billing not enabled</p>
            <p className="mt-2 text-sm">
              Run migration <code>supabase/migrations/20260220_02_billing_companies_columns.sql</code>{" "}
              in the Supabase SQL editor, then set <code>BILLING_ENABLED=true</code>.
            </p>
          </div>
        ) : !stripeConfigured ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4 text-amber-900">
            <p className="font-medium">Stripe not configured</p>
            <p className="mt-2 text-sm">
              Add <code>STRIPE_SECRET_KEY</code> and <code>STRIPE_WEBHOOK_SECRET</code> to your environment.
            </p>
          </div>
        ) : (
          <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-4 text-gray-700">
            <p className="font-medium">Billing scaffold ready</p>
            <p className="mt-2 text-sm">Checkout and portal routes are stubbed and ready for Stripe wiring.</p>
          </div>
        )}
      </div>
    </main>
  );
}
