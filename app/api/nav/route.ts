import { NextResponse } from "next/server";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { normalizeAppRole, toNavItems } from "@/lib/nav/config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { supabase, companyId, userId } = await getCompanyId();

    const { data, error } = await supabase
      .from("memberships")
      .select("role")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .limit(1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const role = normalizeAppRole(data?.[0]?.role);
    if (!role) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({ items: toNavItems(role), role });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
