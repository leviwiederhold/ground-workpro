import { NextResponse } from "next/server";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function POST() {
  if (process.env.E2E !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const { companyId } = await getCompanyId();
    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    }

    const foreignCompanyRes = await supabaseAdmin
      .from("companies")
      .insert({ name: `E2E Foreign Company ${Date.now()}` })
      .select("id")
      .single();

    if (foreignCompanyRes.error || !foreignCompanyRes.data?.id) {
      return NextResponse.json(
        { error: foreignCompanyRes.error?.message || "Failed to create foreign company" },
        { status: 400 }
      );
    }

    const foreignCompanyId = foreignCompanyRes.data.id;
    if (String(foreignCompanyId) === String(companyId)) {
      return NextResponse.json({ error: "Failed to isolate company context" }, { status: 500 });
    }

    const jobRes = await supabaseAdmin
      .from("jobs")
      .insert({
        company_id: foreignCompanyId,
        name: `Foreign Job ${Date.now()}`,
        status: "draft",
      })
      .select("id, company_id, name")
      .single();

    if (jobRes.error || !jobRes.data?.id) {
      return NextResponse.json({ error: jobRes.error?.message || "Failed to seed job" }, { status: 400 });
    }

    return NextResponse.json({
      item: {
        job_id: jobRes.data.id,
        company_id: jobRes.data.company_id,
        name: jobRes.data.name,
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
