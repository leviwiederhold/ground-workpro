import {
  BILLING_OVERRIDE_SELECT_COLUMNS,
  evaluateBillingOverride,
  readableBillingStatus,
  type BillingOverrideEvaluation,
} from "./billingOverride.ts";

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

type CompanyBillingRow = {
  plan_type?: string | null;
  subscription_status?: string | null;
  trial_ends_at?: string | null;
  current_period_end?: string | null;
  billing_override_type?: string | null;
  billing_override_value?: number | string | null;
  billing_override_until?: string | null;
  billing_override_reason?: string | null;
  complimentary_access?: boolean | null;
  complimentary_access_reason?: string | null;
};

type SupabaseQueryResult = {
  data: CompanyBillingRow | null;
  error: { message?: string | null } | null;
};

type SupabaseLike = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => PromiseLike<SupabaseQueryResult>;
      };
    };
  };
};

export type CompanyBillingStatus = {
  plan_type: string;
  subscription_status: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  // Stripe-only active state (active | trialing), unchanged from before.
  stripe_active: boolean;
  // Effective access: Stripe active OR a complimentary override grants access OR
  // the company has the first-class complimentary-access entitlement.
  is_active: boolean;
  // Override summary. `reason` is intentionally omitted from anything employee-facing.
  override: BillingOverrideEvaluation;
  // Company-level complimentary entitlement (decoupled from Stripe/overrides).
  complimentary_access: boolean;
  // INTERNAL reason for the complimentary entitlement — never expose to employees.
  complimentary_reason: string | null;
  // Employee-safe readable label (Active / Complimentary / Discounted x% ...).
  display_status: string;
};

const BASE_COLUMNS = "plan_type, subscription_status, trial_ends_at, current_period_end";
const COMPLIMENTARY_SELECT_COLUMNS = "complimentary_access, complimentary_access_reason";

export async function getCompanyBillingStatus(
  supabase: unknown,
  companyId: string
): Promise<CompanyBillingStatus> {
  const client = supabase as SupabaseLike;

  // Prefer selecting the complimentary + override columns too, but gracefully
  // fall back column-tier by column-tier so older environments that have not yet
  // applied the complimentary and/or override migrations keep working.
  const selectVariants = [
    `${BASE_COLUMNS}, ${BILLING_OVERRIDE_SELECT_COLUMNS}, ${COMPLIMENTARY_SELECT_COLUMNS}`,
    `${BASE_COLUMNS}, ${BILLING_OVERRIDE_SELECT_COLUMNS}`,
    BASE_COLUMNS,
  ];

  let data: CompanyBillingRow | null = null;
  let error: { message?: string | null } | null = null;
  for (const columns of selectVariants) {
    ({ data, error } = await client
      .from("companies")
      .select(columns)
      .eq("id", companyId)
      .maybeSingle());
    if (!error) break;
    // Only retry with fewer columns when a column is missing (older schema);
    // any other error is real and should surface.
    if (!/column|complimentary_access|billing_override/i.test(error.message || "")) break;
  }

  if (error) {
    throw new Error(error.message || "Failed to load billing settings");
  }

  const subscriptionStatus = String(data?.subscription_status ?? "inactive").toLowerCase();
  const stripeActive = ACTIVE_SUBSCRIPTION_STATUSES.has(subscriptionStatus);
  const override = evaluateBillingOverride(data ?? null);
  const complimentaryAccess = Boolean(data?.complimentary_access);
  const isActive = stripeActive || override.grantsFreeAccess || complimentaryAccess;

  // The first-class complimentary entitlement reads as "Complimentary" too, even
  // when there is no billing override backing it.
  const displayStatus =
    complimentaryAccess && !override.grantsFreeAccess
      ? "Complimentary"
      : readableBillingStatus({
          subscriptionStatus,
          override,
          untilLabel: (iso) => {
            const t = Date.parse(iso);
            return Number.isFinite(t)
              ? new Date(t).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
              : iso;
          },
        });

  return {
    plan_type: String(data?.plan_type ?? "groundwork_pro"),
    subscription_status: subscriptionStatus,
    trial_ends_at: data?.trial_ends_at ?? null,
    current_period_end: data?.current_period_end ?? null,
    stripe_active: stripeActive,
    is_active: isActive,
    override,
    complimentary_access: complimentaryAccess,
    complimentary_reason: data?.complimentary_access_reason ?? null,
    display_status: displayStatus,
  };
}

export async function isCompanySubscriptionActive(
  supabase: unknown,
  companyId: string
): Promise<boolean> {
  const status = await getCompanyBillingStatus(supabase, companyId);
  return status.is_active;
}
