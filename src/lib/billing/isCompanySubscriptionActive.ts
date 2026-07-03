import {
  BILLING_OVERRIDE_SELECT_COLUMNS,
  evaluateBillingOverride,
  readableBillingStatus,
  type BillingOverrideEvaluation,
} from "@/lib/billing/billingOverride";

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
  // Effective access: Stripe active OR a complimentary override grants access.
  is_active: boolean;
  // Override summary. `reason` is intentionally omitted from anything employee-facing.
  override: BillingOverrideEvaluation;
  // Employee-safe readable label (Active / Complimentary / Discounted x% ...).
  display_status: string;
};

const BASE_COLUMNS = "plan_type, subscription_status, trial_ends_at, current_period_end";

export async function getCompanyBillingStatus(
  supabase: unknown,
  companyId: string
): Promise<CompanyBillingStatus> {
  const client = supabase as SupabaseLike;

  // Prefer selecting override columns too; gracefully fall back if the billing
  // overrides migration has not been applied yet (older environments).
  let { data, error } = await client
    .from("companies")
    .select(`${BASE_COLUMNS}, ${BILLING_OVERRIDE_SELECT_COLUMNS}`)
    .eq("id", companyId)
    .maybeSingle();

  if (error && /billing_override/i.test(error.message || "")) {
    ({ data, error } = await client
      .from("companies")
      .select(BASE_COLUMNS)
      .eq("id", companyId)
      .maybeSingle());
  }

  if (error) {
    throw new Error(error.message || "Failed to load billing settings");
  }

  const subscriptionStatus = String(data?.subscription_status ?? "inactive").toLowerCase();
  const stripeActive = ACTIVE_SUBSCRIPTION_STATUSES.has(subscriptionStatus);
  const override = evaluateBillingOverride(data ?? null);
  const isActive = stripeActive || override.grantsFreeAccess;

  return {
    plan_type: String(data?.plan_type ?? "groundwork_pro"),
    subscription_status: subscriptionStatus,
    trial_ends_at: data?.trial_ends_at ?? null,
    current_period_end: data?.current_period_end ?? null,
    stripe_active: stripeActive,
    is_active: isActive,
    override,
    display_status: readableBillingStatus({
      subscriptionStatus,
      override,
      untilLabel: (iso) => {
        const t = Date.parse(iso);
        return Number.isFinite(t)
          ? new Date(t).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
          : iso;
      },
    }),
  };
}

export async function isCompanySubscriptionActive(
  supabase: unknown,
  companyId: string
): Promise<boolean> {
  const status = await getCompanyBillingStatus(supabase, companyId);
  return status.is_active;
}
