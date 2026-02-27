import { NextResponse } from "next/server";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getEffectiveRole, resolveRealRole } from "@/lib/auth/effectiveRole";
import { toNavItems } from "@/lib/nav/config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { supabase, companyId, userId } = await getCompanyId();
    const realRole = await resolveRealRole(supabase, companyId, userId);
    const role = await getEffectiveRole();
    if (!role || !realRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({
      items: toNavItems(role),
      role,
      realRole,
      canSwitchRoleView: realRole === "admin",
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
