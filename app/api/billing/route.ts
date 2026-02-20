import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/requireRole";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getCompanyBillingSnapshot } from "@/lib/billing/subscription";
import { isStripeConfigured } from "@/lib/billing/stripe";

export async function GET() {
  try {
    try {
      await requireRole(["admin"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!isStripeConfigured()) {
      return NextResponse.json({ error: "Stripe not configured" }, { status: 501 });
    }

    const { supabase, companyId } = await getCompanyId();
    const billing = await getCompanyBillingSnapshot(supabase, companyId);

    return NextResponse.json({
      item: {
        plan_type: billing.planType,
        subscription_status: billing.subscriptionStatus,
      },
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unexpected server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
