const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

type CompanyBillingRow = {
  plan_type?: string | null;
  subscription_status?: string | null;
  trial_ends_at?: string | null;
  current_period_end?: string | null;
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
  is_active: boolean;
};

export async function getCompanyBillingStatus(
  supabase: unknown,
  companyId: string
): Promise<CompanyBillingStatus> {
  const client = supabase as SupabaseLike;
  const { data, error } = await client
    .from("companies")
    .select("plan_type, subscription_status, trial_ends_at, current_period_end")
    .eq("id", companyId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Failed to load billing settings");
  }

  const subscriptionStatus = String(data?.subscription_status ?? "inactive").toLowerCase();

  return {
    plan_type: String(data?.plan_type ?? "groundwork_pro"),
    subscription_status: subscriptionStatus,
    trial_ends_at: data?.trial_ends_at ?? null,
    current_period_end: data?.current_period_end ?? null,
    is_active: ACTIVE_SUBSCRIPTION_STATUSES.has(subscriptionStatus),
  };
}

export async function isCompanySubscriptionActive(
  supabase: unknown,
  companyId: string
): Promise<boolean> {
  const status = await getCompanyBillingStatus(supabase, companyId);
  return status.is_active;
}
