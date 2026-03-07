import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { findInventoryItem, mapLedgerItem, normalizeRouteId } from "../../_lib/ledger";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    try {
      await requireRole(["admin", "pm", "foreman", "mechanic", "operator"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const parsedQuery = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
    if (!parsedQuery.success) {
      return NextResponse.json({ error: "Validation error", details: parsedQuery.error.flatten() }, { status: 422 });
    }

    const itemId = normalizeRouteId(id);
    const { supabase, companyId } = await getCompanyId();
    const itemResult = await findInventoryItem(supabase, companyId, itemId);
    if (itemResult.error) {
      return NextResponse.json({ error: itemResult.error.message }, { status: 400 });
    }
    if (!itemResult.item) {
      return NextResponse.json({ error: "Inventory item not found" }, { status: 404 });
    }

    let ledgerResult = await supabase
      .from("inventory_transactions")
      .select("*")
      .eq("company_id", companyId)
      .eq("item_id", itemId)
      .order("created_at", { ascending: false })
      .limit(parsedQuery.data.limit);

    if (ledgerResult.error?.message?.toLowerCase().includes("created_at")) {
      ledgerResult = await supabase
        .from("inventory_transactions")
        .select("*")
        .eq("company_id", companyId)
        .eq("item_id", itemId)
        .order("id", { ascending: false })
        .limit(parsedQuery.data.limit);
    }

    if (ledgerResult.error) {
      const message = (ledgerResult.error.message || "").toLowerCase();
      if (message.includes("inventory_transactions") && (message.includes("does not exist") || message.includes("not find"))) {
        return NextResponse.json({ items: [] });
      }
      return NextResponse.json({ error: ledgerResult.error.message }, { status: 400 });
    }

    return NextResponse.json({ items: (ledgerResult.data ?? []).map(mapLedgerItem) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Internal server error" }, { status: 500 });
  }
}
