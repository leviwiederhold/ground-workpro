import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import {
  findInventoryItem,
  insertInventoryTransaction,
  INVENTORY_WRITE_ROLES,
  mapInventory,
  mapLedgerItem,
  getQtyOnHand,
  normalizeNumber,
  normalizeRouteId,
  updateInventoryRow,
  upsertLowStockAlert,
} from "../../_lib/ledger";

const bodySchema = z.object({
  qty: z.number().min(0),
  unit_cost: z.number().nonnegative().optional(),
  notes: z.string().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    try {
      await requireRole([...INVENTORY_WRITE_ROLES]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation error", details: parsed.error.flatten() }, { status: 422 });
    }

    const { id } = await params;
    const itemId = normalizeRouteId(id);
    const { supabase, companyId, userId } = await getCompanyId();
    const itemResult = await findInventoryItem(supabase, companyId, itemId);
    if (itemResult.error) {
      return NextResponse.json({ error: itemResult.error.message }, { status: 400 });
    }
    if (!itemResult.item) {
      return NextResponse.json({ error: "Inventory item not found" }, { status: 404 });
    }

    const item = itemResult.item;
    const prevQty = getQtyOnHand(item);
    const nextQty = parsed.data.qty;
    const delta = nextQty - prevQty;
    const unitCost = parsed.data.unit_cost ?? normalizeNumber(item.unit_cost ?? item.unitCost);

    const updateResult = await updateInventoryRow(supabase, companyId, itemId, {
      quantity_on_hand: nextQty,
      unit_cost: unitCost,
    });
    if (updateResult.error) {
      return NextResponse.json({ error: updateResult.error.message }, { status: 400 });
    }

    const txResult = await insertInventoryTransaction(supabase, {
      company_id: companyId,
      item_id: itemId,
      type: "adjust",
      qty: delta,
      unit_cost: unitCost,
      from_location: item.location ?? "",
      to_location: item.location ?? "",
      notes: parsed.data.notes ?? "",
      created_by: userId,
    });
    if (txResult.error) {
      return NextResponse.json({ error: txResult.error.message }, { status: 400 });
    }

    await upsertLowStockAlert(supabase, companyId, updateResult.data ?? item);

    return NextResponse.json({
      item: {
        inventory: mapInventory(updateResult.data ?? item, unitCost),
        transaction: mapLedgerItem(txResult.data),
      },
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Internal server error" }, { status: 500 });
  }
}
