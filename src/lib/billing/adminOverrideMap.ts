import {
  BILLING_OVERRIDE_SELECT_COLUMNS,
  evaluateBillingOverride,
  readableBillingStatus,
} from "@/lib/billing/billingOverride";

// Columns the admin billing-override endpoints select from `companies`.
export const ADMIN_OVERRIDE_SELECT_COLUMNS = `id, name, email, subscription_status, plan_type, trial_ends_at, current_period_end, ${BILLING_OVERRIDE_SELECT_COLUMNS}`;

function untilLabel(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t)
    ? new Date(t).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
    : iso;
}

// Shape a company row for the platform-admin UI. Unlike the employee-facing
// billing status, this DOES include the internal reason/authorship (admin-only).
export function mapCompanyOverride(row: Record<string, unknown>) {
  const subscriptionStatus = String(row.subscription_status ?? "inactive").toLowerCase();
  const override = evaluateBillingOverride(row);
  return {
    company_id: row.id,
    name: row.name ?? "",
    email: row.email ?? "",
    subscription_status: subscriptionStatus,
    plan_type: row.plan_type ?? "groundwork_pro",
    trial_ends_at: row.trial_ends_at ?? null,
    current_period_end: row.current_period_end ?? null,
    stripe_active: subscriptionStatus === "active" || subscriptionStatus === "trialing",
    grants_free_access: override.grantsFreeAccess,
    display_status: readableBillingStatus({ subscriptionStatus, override, untilLabel }),
    override: {
      type: override.type,
      value: override.discountPercent ?? override.discountAmountCents ?? null,
      until: override.until,
      is_expired: override.isExpired,
      reason: row.billing_override_reason ?? null,
      created_by: row.billing_override_created_by ?? null,
      created_at: row.billing_override_created_at ?? null,
      updated_at: row.billing_override_updated_at ?? null,
    },
  };
}
