import { NextResponse } from "next/server";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getSetupStatusForUser } from "@/lib/onboarding/setupFlow";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { supabase, companyId, userId, userEmail } = await getCompanyId();
    const status = await getSetupStatusForUser({
      supabase,
      companyId,
      userId,
      userEmail: String(userEmail ?? "").trim(),
    });
    return NextResponse.json({ item: status });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
