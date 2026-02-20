import { NextResponse } from "next/server";

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

type SupabaseQueryResult = {
  data: { plan_type?: string | null; subscription_status?: string | null } | null;
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

export type BillingSnapshot = {
  planType: string;
  subscriptionStatus: string;
};

export async function getCompanyBillingSnapshot(
  supabase: unknown,
  companyId: string
): Promise<BillingSnapshot> {
  const client = supabase as SupabaseLike;
  const { data, error } = await client
    .from("companies")
    .select("plan_type, subscription_status")
    .eq("id", companyId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Failed to load billing settings");
  }

  return {
    planType: String(data?.plan_type ?? "free"),
    subscriptionStatus: String(data?.subscription_status ?? "inactive"),
  };
}

export async function requireActiveSubscription(
  supabase: unknown,
  companyId: string
): Promise<NextResponse | null> {
  const billing = await getCompanyBillingSnapshot(supabase, companyId);
  if (!ACTIVE_STATUSES.has(billing.subscriptionStatus.toLowerCase())) {
    return NextResponse.json({ error: "Subscription required" }, { status: 402 });
  }
  return null;
}
