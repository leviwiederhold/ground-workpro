import { NextResponse } from "next/server";
import { isCompanySubscriptionActive } from "@/lib/billing/isCompanySubscriptionActive";

export async function requireActiveSubscription(
  supabase: unknown,
  companyId: string
): Promise<NextResponse | null> {
  const isActive = await isCompanySubscriptionActive(supabase, companyId);
  if (!isActive) {
    return NextResponse.json({ error: "Subscription required" }, { status: 402 });
  }
  return null;
}
