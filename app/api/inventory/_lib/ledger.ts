/* eslint-disable @typescript-eslint/no-explicit-any */

export const INVENTORY_WRITE_ROLES = ["admin", "pm", "mechanic", "foreman"] as const;

export const normalizeRouteId = (id: string) => (/^\d+$/.test(id) ? Number(id) : id);

export const normalizeId = (id: unknown) => {
  if (id === null || id === undefined || id === "") return null;
  if (typeof id === "number") return id;
  if (typeof id === "string" && /^\d+$/.test(id)) return Number(id);
  return id;
};

export const normalizeNumber = (value: unknown, fallback = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const INVENTORY_META_TAG_REGEX = /^__gw_inventory_meta:([^\n]+)__\n?/i;

export const parseInventoryMeta = (notes: unknown) => {
  const text = String(notes ?? "");
  const line = text.match(INVENTORY_META_TAG_REGEX)?.[1];
  if (!line) return {};
  const params = new URLSearchParams(line);
  return {
    qty_reserved: params.get("qty_reserved"),
  };
};

export const stripInventoryMetaTag = (notes: unknown) =>
  String(notes ?? "").replace(INVENTORY_META_TAG_REGEX, "").trimStart();

export const buildNotesWithQtyReserved = (notes: unknown, qtyReserved: number) => {
  const cleanNotes = stripInventoryMetaTag(notes);
  const params = new URLSearchParams();
  params.set("qty_reserved", String(Math.max(0, qtyReserved)));
  if (!cleanNotes) return `__gw_inventory_meta:${params.toString()}__`;
  return `__gw_inventory_meta:${params.toString()}__\n${cleanNotes}`;
};

export const getQtyOnHand = (row: any) =>
  normalizeNumber(row.quantity_on_hand ?? row.qty_on_hand ?? row.qtyOnHand);

export const getQtyReserved = (row: any) => {
  const meta = parseInventoryMeta(row.notes ?? "");
  const hasMetaReserved = Object.prototype.hasOwnProperty.call(meta, "qty_reserved");
  const metaReserved = hasMetaReserved ? normalizeNumber(meta.qty_reserved, 0) : null;
  const columnReserved = normalizeNumber(row.qty_reserved ?? row.qtyReserved, 0);
  return metaReserved ?? columnReserved;
};

export const mapInventory = (row: any, lastUnitCost = 0) => {
  const qtyOnHand = getQtyOnHand(row);
  const qtyReserved = getQtyReserved(row);
  const reorderPoint = normalizeNumber(row.reorder_point ?? row.reorderPoint);
  const unitCost = normalizeNumber(row.unit_cost ?? row.unitCost);
  return {
    id: row.id,
    name: row.name ?? "",
    category: row.category ?? "Materials",
    unit: row.unit ?? "EA",
    qtyOnHand,
    qtyReserved,
    available: qtyOnHand - qtyReserved,
    reorderPoint,
    unitCost,
    lastUnitCost: normalizeNumber(lastUnitCost || unitCost),
    jobId: normalizeId(row.job_id ?? row.jobId),
    location: row.location ?? "",
    status: row.status ?? "active",
    lowStock: qtyOnHand <= reorderPoint,
  };
};

export const mapLedgerItem = (row: any) => ({
  id: row.id,
  itemId: normalizeId(row.item_id),
  type: row.type ?? "adjust",
  qty: normalizeNumber(row.qty),
  unitCost: normalizeNumber(row.unit_cost),
  fromLocation: row.from_location ?? "",
  toLocation: row.to_location ?? "",
  jobId: normalizeId(row.job_id),
    notes: stripInventoryMetaTag(row.notes ?? ""),
  createdAt: row.created_at ?? "",
});

export async function findInventoryItem(supabase: any, companyId: string, id: string | number) {
  const { data, error } = await supabase
    .from("inventory")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle();

  if (error) return { error };
  return { item: data };
}

export async function verifyJobBelongsToCompany(
  supabase: any,
  companyId: string,
  jobId: string | number | null
) {
  if (!jobId) return { ok: true };
  const { data, error } = await supabase
    .from("jobs")
    .select("id")
    .eq("company_id", companyId)
    .eq("id", jobId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Job not found" };
  return { ok: true };
}

export async function insertInventoryTransaction(
  supabase: any,
  payload: Record<string, unknown>
) {
  const currentPayload = { ...payload };
  let lastResult: any = null;

  for (let i = 0; i < 20; i += 1) {
    const result = await supabase
      .from("inventory_transactions")
      .insert(currentPayload)
      .select("*")
      .single();
    lastResult = result;
    const message = result.error?.message || "";
    const match = message.match(/Could not find the '([^']+)' column/);
    if (!match) return result;
    const missingColumn = match[1];
    if (!(missingColumn in currentPayload)) return result;
    delete currentPayload[missingColumn];
  }

  return lastResult;
}

export async function updateInventoryRow(
  supabase: any,
  companyId: string,
  itemId: string | number,
  payload: Record<string, unknown>
) {
  const currentPayload = { ...payload };
  let lastResult: any = null;

  for (let i = 0; i < 20; i += 1) {
    const result = await supabase
      .from("inventory")
      .update(currentPayload)
      .eq("company_id", companyId)
      .eq("id", itemId)
      .select("*")
      .maybeSingle();
    lastResult = result;
    const message = result.error?.message || "";
    const match = message.match(/Could not find the '([^']+)' column/);
    if (!match) return result;
    const missingColumn = match[1];
    if (!(missingColumn in currentPayload)) return result;
    delete currentPayload[missingColumn];
  }

  return lastResult;
}

export async function upsertLowStockAlert(
  supabase: any,
  companyId: string,
  item: any
) {
  const qtyOnHand = getQtyOnHand(item);
  const reorderPoint = normalizeNumber(item.reorder_point ?? item.reorderPoint);
  const dedupeKey = `inventory-low-stock:${item.id}`;
  const title = "Low inventory";
  const message = `${item.name ?? "Inventory item"} is below reorder point`;

  if (qtyOnHand <= reorderPoint) {
    await supabase.from("alerts").upsert(
      {
        company_id: companyId,
        alert_type: "low_inventory",
        title,
        message,
        entity_type: "inventory",
        entity_id: String(item.id),
        dedupe_key: dedupeKey,
        metadata: {
          qtyOnHand,
          reorderPoint,
          itemName: item.name ?? "",
        },
      },
      { onConflict: "company_id,dedupe_key" }
    );
    return;
  }

  await supabase
    .from("alerts")
    .delete()
    .eq("company_id", companyId)
    .eq("dedupe_key", dedupeKey);
}

export async function recordIssueJobCostHook(
  supabase: any,
  companyId: string,
  jobId: string | number,
  item: any,
  qty: number,
  unitCost: number,
  userId?: string | null
) {
  const payload = {
    company_id: companyId,
    job_id: jobId,
    entry_type: "material",
    description: `Inventory issue: ${item.name ?? "Inventory Item"}`,
    quantity: qty,
    unit_cost: unitCost,
    total_cost: qty * unitCost,
    created_by: userId ?? null,
  };

  const { error } = await supabase.from("daily_report_entries").insert(payload);
  if (!error) return;

  // Best-effort compatibility fallback when pricing columns differ.
  const fallbackPayload: Record<string, unknown> = {
    company_id: companyId,
    job_id: jobId,
    entry_type: "material",
    description: `Inventory issue: ${item.name ?? "Inventory Item"}`,
    quantity: qty * unitCost,
  };
  if (userId) fallbackPayload.created_by = userId;
  await supabase.from("daily_report_entries").insert(fallbackPayload);
}
