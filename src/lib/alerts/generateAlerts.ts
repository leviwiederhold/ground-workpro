/* eslint-disable @typescript-eslint/no-explicit-any */
type InventoryRow = {
  id: string | number;
  name: string | null;
  quantity_on_hand?: number | null;
  qty_on_hand?: number | null;
  qtyOnHand?: number | null;
  reorder_level?: number | null;
  reorder_point?: number | null;
  reorderPoint?: number | null;
  status?: string | null;
};

type WorkOrderRow = {
  id: string | number;
  title?: string | null;
  due_date?: string | null;
  dueDate?: string | null;
  status?: string | null;
  priority?: string | null;
};

export type AlertCandidate = {
  alert_type: "low_inventory" | "overdue_maintenance";
  title: string;
  message: string;
  entity_type: "inventory" | "work_order" | "equipment";
  entity_id: string;
  dedupe_key: string;
  metadata: Record<string, unknown>;
};

function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizeStatus(value: unknown): string {
  return String(value ?? "").toLowerCase().replaceAll("_", "-");
}

function normalizeDate(value: unknown): string | null {
  if (!value) return null;
  const text = String(value);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return text.slice(0, 10);
}

export function buildAlertCandidates(
  inventoryRows: InventoryRow[],
  workOrderRows: WorkOrderRow[]
): AlertCandidate[] {
  const today = new Date().toISOString().slice(0, 10);
  const candidates: AlertCandidate[] = [];

  for (const item of inventoryRows) {
    const qtyOnHand = toNumber(item.quantity_on_hand ?? item.qty_on_hand ?? item.qtyOnHand);
    const reorderPoint = toNumber(item.reorder_level ?? item.reorder_point ?? item.reorderPoint);
    if (reorderPoint <= 0 || qtyOnHand > reorderPoint) continue;

    const entityId = String(item.id);
    const itemName = item.name ?? "Inventory item";
    candidates.push({
      alert_type: "low_inventory",
      title: "Low inventory",
      message: `${itemName} is low (${qtyOnHand} on hand, reorder at ${reorderPoint})`,
      entity_type: "inventory",
      entity_id: entityId,
      dedupe_key: `low_inventory:${entityId}`,
      metadata: {
        name: itemName,
        qtyOnHand,
        reorderPoint,
      },
    });
  }

  for (const workOrder of workOrderRows) {
    const dueDate = normalizeDate(workOrder.due_date ?? workOrder.dueDate);
    if (!dueDate) continue;
    const status = normalizeStatus(workOrder.status);
    if (status === "completed") continue;
    if (dueDate >= today) continue;

    const entityId = String(workOrder.id);
    const title = workOrder.title ?? "Maintenance work order";
    candidates.push({
      alert_type: "overdue_maintenance",
      title: "Overdue maintenance",
      message: `${title} was due on ${dueDate}`,
      entity_type: "work_order",
      entity_id: entityId,
      dedupe_key: `overdue_maintenance:${entityId}`,
      metadata: {
        title,
        dueDate,
        status,
        priority: workOrder.priority ?? null,
      },
    });
  }

  return candidates;
}

export async function generateAlertsForCompany(
  supabase: any,
  companyId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [inventoryResult, workOrdersResult, existingResult] = await Promise.all([
    supabase
      .from("inventory")
      .select("*")
      .eq("company_id", companyId),
    supabase
      .from("work_orders")
      .select("*")
      .eq("company_id", companyId),
    supabase
      .from("alerts")
      .select("id, dedupe_key, alert_type")
      .eq("company_id", companyId)
      .in("alert_type", ["low_inventory", "overdue_maintenance"]),
  ]);

  if (inventoryResult.error) return { ok: false, error: inventoryResult.error.message };
  if (workOrdersResult.error) return { ok: false, error: workOrdersResult.error.message };
  if (existingResult.error) return { ok: false, error: existingResult.error.message };

  const candidates = buildAlertCandidates(
    (inventoryResult.data ?? []) as InventoryRow[],
    (workOrdersResult.data ?? []) as WorkOrderRow[]
  );
  const activeKeys = new Set(candidates.map((item) => item.dedupe_key));

  const staleAlertIds = (existingResult.data ?? [])
    .filter((row: { id: string; dedupe_key: string }) => !activeKeys.has(row.dedupe_key))
    .map((row: { id: string }) => row.id);

  if (staleAlertIds.length > 0) {
    const staleDelete = await supabase
      .from("alerts")
      .delete()
      .eq("company_id", companyId)
      .in("id", staleAlertIds);
    if (staleDelete.error) return { ok: false, error: staleDelete.error.message };
  }

  if (candidates.length > 0) {
    const upsertPayload = candidates.map((item) => ({
      company_id: companyId,
      alert_type: item.alert_type,
      title: item.title,
      message: item.message,
      entity_type: item.entity_type,
      entity_id: item.entity_id,
      dedupe_key: item.dedupe_key,
      metadata: item.metadata,
    }));

    const upsertResult = await supabase
      .from("alerts")
      .upsert(upsertPayload, { onConflict: "company_id,dedupe_key" });

    if (upsertResult.error) return { ok: false, error: upsertResult.error.message };
  }

  return { ok: true };
}
