/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { calcBid } from "@/lib/pricing/calcBid";

const normalizeRouteId = (id: string) => (/^\d+$/.test(id) ? Number(id) : id);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const bidId = normalizeRouteId(id);
    const { supabase, companyId } = await getCompanyId();

    const { data: bidRow, error: bidError } = await supabase
      .from("bids")
      .select("id")
      .eq("company_id", companyId)
      .eq("id", bidId)
      .maybeSingle();

    if (bidError) {
      return NextResponse.json({ error: bidError.message }, { status: 400 });
    }
    if (!bidRow) {
      return NextResponse.json({ error: "Bid not found" }, { status: 404 });
    }

    const { data: pricingSettings, error: pricingError } = await supabase
      .from("pricing_settings")
      .select("*")
      .eq("company_id", companyId)
      .maybeSingle();

    if (pricingError && !pricingError.message.toLowerCase().includes("does not exist")) {
      return NextResponse.json({ error: pricingError.message }, { status: 400 });
    }

    const { data: bidItems, error: itemsError } = await supabase
      .from("bid_items")
      .select("item_type, quantity, unit_cost, total_cost")
      .eq("company_id", companyId)
      .eq("bid_id", bidId);

    if (itemsError) {
      return NextResponse.json({ error: itemsError.message }, { status: 400 });
    }

    const summary = calcBid(pricingSettings ?? null, bidItems ?? []);
    return NextResponse.json({ summary });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
