import { NextResponse } from "next/server";
import { getEffectiveRole } from "@/lib/auth/effectiveRole";
import { toNavItems } from "@/lib/nav/config";
import { TenantResolverError } from "@/lib/tenant/getCompanyId";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const role = await getEffectiveRole();
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
