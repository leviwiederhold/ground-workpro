import { NextResponse } from "next/server";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getCompanyBillingStatus } from "@/lib/billing/isCompanySubscriptionActive";

export async function GET() {
  try {
    const { supabase, companyId } = await getCompanyId();
    const status = await getCompanyBillingStatus(supabase, companyId);

    return NextResponse.json({ item: status });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unexpected server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
