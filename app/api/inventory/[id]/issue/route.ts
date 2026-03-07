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
  normalizeId,
  normalizeNumber,
  normalizeRouteId,
  recordIssueJobCostHook,
  updateInventoryRow,
  upsertLowStockAlert,
  verifyJobBelongsToCompany,
} from "../../_lib/ledger";

const bodySchema = z.object({
  qty: z.number().positive(),
  job_id: z.union([z.string(), z.number()]).optional().nullable(),
  notes: z.string().optional(),
  from_location: z.string().optional(),
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

    const normalizedJobId = normalizeId(parsed.data.job_id);
    const jobId =
      normalizedJobId === null || typeof normalizedJobId === "string" || typeof normalizedJobId === "number"
        ? normalizedJobId
        : null;
    const jobCheck = await verifyJobBelongsToCompany(supabase, companyId, jobId);
    if (!jobCheck.ok) {
      return NextResponse.json({ error: jobCheck.error }, { status: 404 });
    }

    const item = itemResult.item;
    const qtyOnHand = getQtyOnHand(item);
    if (parsed.data.qty > qtyOnHand) {
      return NextResponse.json({ error: "Insufficient inventory quantity" }, { status: 400 });
    }

    const nextQtyOnHand = qtyOnHand - parsed.data.qty;
    const unitCost = normalizeNumber(item.unit_cost ?? item.unitCost);

    const updateResult = await updateInventoryRow(supabase, companyId, itemId, {
      quantity_on_hand: nextQtyOnHand,
      ...(jobId ? { job_id: jobId } : {}),
    });
    if (updateResult.error) {
      return NextResponse.json({ error: updateResult.error.message }, { status: 400 });
    }

    const txResult = await insertInventoryTransaction(supabase, {
      company_id: companyId,
      item_id: itemId,
      type: "issue",
      qty: parsed.data.qty,
      unit_cost: unitCost,
      from_location: parsed.data.from_location ?? item.location ?? "",
      to_location: null,
      job_id: jobId,
      notes: parsed.data.notes ?? "",
      created_by: userId,
    });
    if (txResult.error) {
      return NextResponse.json({ error: txResult.error.message }, { status: 400 });
    }

    if (jobId) {
      await recordIssueJobCostHook(supabase, companyId, jobId, item, parsed.data.qty, unitCost, userId);
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
