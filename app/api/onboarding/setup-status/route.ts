import { NextResponse } from "next/server";
import { getOptionalCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getSetupStatusForUser, markOptionalSetupStepsSkipped } from "@/lib/onboarding/setupFlow";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { supabase, companyId, userId, userEmail } = await getOptionalCompanyId();
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

export async function POST(request: Request) {
  try {
    const { supabase, companyId, userId, userEmail } = await getOptionalCompanyId();
    const body = await request.json().catch(() => ({}));
    if (String(body?.action ?? "") !== "skip_optional_steps") {
      return NextResponse.json({ error: "Invalid action" }, { status: 422 });
    }

    const status = await getSetupStatusForUser({
      supabase,
      companyId,
      userId,
      userEmail: String(userEmail ?? "").trim(),
    });

    if (!status.required_complete) {
      return NextResponse.json({ error: "Required setup steps must be completed first" }, { status: 409 });
    }

    await markOptionalSetupStepsSkipped({
      supabase,
      companyId,
      userId,
    });

    const nextStatus = await getSetupStatusForUser({
      supabase,
      companyId,
      userId,
      userEmail: String(userEmail ?? "").trim(),
    });

    return NextResponse.json({ item: nextStatus });
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
