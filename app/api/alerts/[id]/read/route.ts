import { NextResponse } from "next/server";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { markFallbackAlertRead } from "@/lib/alerts/fallbackStore";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const isFallbackId = id.includes(":");
    if (!uuidPattern.test(id) && !isFallbackId) {
      return NextResponse.json(
        {
          error: "Validation error",
          details: [{ path: "id", message: "Invalid alert id" }],
        },
        { status: 422 }
      );
    }

    const { supabase, companyId } = await getCompanyId();

    if (isFallbackId) {
      const updated = markFallbackAlertRead(companyId, id);
      if (!updated) {
        return NextResponse.json({ error: "Alert not found" }, { status: 404 });
      }
      return NextResponse.json({ item: { success: true } });
    }

    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("alerts")
      .update({ is_read: true, read_at: now })
      .eq("company_id", companyId)
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) {
      const message = String(error.message || "").toLowerCase();
      if (message.includes("alerts") && (message.includes("does not exist") || message.includes("not find"))) {
        const updated = markFallbackAlertRead(companyId, id);
        if (!updated) {
          return NextResponse.json({ error: "Alert not found" }, { status: 404 });
        }
        return NextResponse.json({ item: { success: true } });
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (!data) {
      return NextResponse.json({ error: "Alert not found" }, { status: 404 });
    }

    return NextResponse.json({ item: { success: true } });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
