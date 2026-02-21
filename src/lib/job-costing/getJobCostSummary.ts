/* eslint-disable @typescript-eslint/no-explicit-any */
import { calcBid } from "@/lib/pricing/calcBid";

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const toNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const normalizeId = (value: unknown): string | number | null => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  if (typeof value === "string") return value;
  return String(value);
};

const pick = (row: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
};

const isMissingColumnError = (message: string) => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("could not find the") ||
    normalized.includes("column") && normalized.includes("does not exist") ||
    normalized.includes("schema cache")
  );
};

type QueryVariant = {
  table: string;
  select?: string;
  filters?: Array<{ column: string; value: unknown; op?: "eq" | "in" }>;
  order?: { column: string; ascending?: boolean };
  limit?: number;
};

async function queryVariants(supabase: any, variants: QueryVariant[]) {
  let lastNonMissingError: string | null = null;

  for (const variant of variants) {
    let query = supabase.from(variant.table).select(variant.select ?? "*");

    for (const filter of variant.filters ?? []) {
      if (filter.op === "in") {
        query = query.in(filter.column, filter.value as any[]);
      } else {
        query = query.eq(filter.column, filter.value);
      }
    }

    if (variant.order) {
      query = query.order(variant.order.column, { ascending: variant.order.ascending ?? true });
    }

    if (typeof variant.limit === "number") {
      query = query.limit(variant.limit);
    }

    const result = await query;
    if (!result.error) return { data: result.data ?? [], error: null as string | null };

    if (isMissingColumnError(String(result.error.message || ""))) {
      continue;
    }

    lastNonMissingError = result.error.message || "Unexpected query error";
    break;
  }

  if (lastNonMissingError) {
    return { data: [] as any[], error: lastNonMissingError };
  }

  return { data: [] as any[], error: null as string | null };
}

type JobCostSummary = {
  jobId: string | number;
  estimatedCost: number;
  estimatedRevenue: number;
  actualLaborCost: number;
  actualEquipmentCost: number;
  actualMaterialCost: number;
  actualTotalCost: number;
  actualCost: number;
  varianceAmount: number;
  variancePercent: number;
  thresholdPercent: number;
  isOverBudget: boolean;
  estimatedMarginPercent: number;
  actualMarginPercent: number;
  marginDriftPercent: number;
  breakdown: {
    dailyReportLaborCost: number;
    dailyReportEquipmentCost: number;
    dailyReportMaterialCost: number;
    purchaseOrderItemsCost: number;
    inventoryUsageCost: number;
  };
  warnings: string[];
};

async function fetchBidEstimate(supabase: any, companyId: string, jobId: string | number) {
  const bidRowsResult = await queryVariants(supabase, [
    {
      table: "bids",
      select: "*",
      filters: [
        { column: "company_id", value: companyId },
        { column: "job_id", value: jobId },
      ],
      order: { column: "created_at", ascending: false },
      limit: 1,
    },
    {
      table: "bids",
      select: "*",
      filters: [
        { column: "company_id", value: companyId },
        { column: "jobId", value: jobId },
      ],
      order: { column: "created_at", ascending: false },
      limit: 1,
    },
    {
      table: "bids",
      select: "*",
      filters: [
        { column: "company_id", value: companyId },
        { column: "job_id", value: jobId },
      ],
      order: { column: "id", ascending: false },
      limit: 1,
    },
    {
      table: "bids",
      select: "*",
      filters: [
        { column: "company_id", value: companyId },
        { column: "jobId", value: jobId },
      ],
      order: { column: "id", ascending: false },
      limit: 1,
    },
  ]);

  if (bidRowsResult.error) return { error: bidRowsResult.error };
  const bid = (bidRowsResult.data ?? [])[0] as Record<string, unknown> | undefined;
  if (!bid) {
    return { bidId: null as string | number | null, estimatedCost: 0, estimatedRevenue: 0 };
  }

  const bidId = normalizeId(bid.id);
  if (bidId === null) {
    return { bidId: null as string | number | null, estimatedCost: 0, estimatedRevenue: 0 };
  }

  const bidItemsResult = await queryVariants(supabase, [
    {
      table: "bid_items",
      select: "*",
      filters: [
        { column: "company_id", value: companyId },
        { column: "bid_id", value: bidId },
      ],
    },
    {
      table: "bid_items",
      select: "*",
      filters: [{ column: "bid_id", value: bidId }],
    },
    {
      table: "bid_items",
      select: "*",
      filters: [
        { column: "company_id", value: companyId },
        { column: "bidId", value: bidId },
      ],
    },
    {
      table: "bid_items",
      select: "*",
      filters: [{ column: "bidId", value: bidId }],
    },
  ]);

  if (bidItemsResult.error) return { error: bidItemsResult.error };

  const estimateFromSummary = calcBid(null, bidItemsResult.data ?? []);

  const estimatedCost =
    toNumber(pick(bid, ["subtotal", "estimated_cost", "estimatedCost"])) > 0
      ? round2(toNumber(pick(bid, ["subtotal", "estimated_cost", "estimatedCost"])))
      : round2(estimateFromSummary.subtotalCost);

  const estimatedRevenue =
    toNumber(pick(bid, ["total", "amount", "estimated_revenue", "estimatedRevenue"])) > 0
      ? round2(toNumber(pick(bid, ["total", "amount", "estimated_revenue", "estimatedRevenue"])))
      : round2(estimateFromSummary.revenue);

  return { bidId, estimatedCost, estimatedRevenue };
}

export async function getJobCostSummary(
  supabase: any,
  companyId: string,
  jobId: string | number
): Promise<{ ok: true; summary: JobCostSummary } | { ok: false; error: string }> {
  const estimateResult = await fetchBidEstimate(supabase, companyId, jobId);
  if ("error" in estimateResult) {
    return { ok: false, error: estimateResult.error || "Failed to load bid estimate" };
  }

  const dailyReportsResult = await queryVariants(supabase, [
    {
      table: "daily_reports",
      select: "id",
      filters: [
        { column: "company_id", value: companyId },
        { column: "job_id", value: jobId },
      ],
    },
    {
      table: "daily_reports",
      select: "id",
      filters: [
        { column: "company_id", value: companyId },
        { column: "jobId", value: jobId },
      ],
    },
    { table: "daily_reports", select: "id", filters: [{ column: "job_id", value: jobId }] },
    { table: "daily_reports", select: "id", filters: [{ column: "jobId", value: jobId }] },
  ]);

  if (dailyReportsResult.error) return { ok: false, error: dailyReportsResult.error };

  const poResult = await queryVariants(supabase, [
    {
      table: "purchase_orders",
      select: "id",
      filters: [
        { column: "company_id", value: companyId },
        { column: "job_id", value: jobId },
      ],
    },
    {
      table: "purchase_orders",
      select: "id",
      filters: [
        { column: "company_id", value: companyId },
        { column: "jobId", value: jobId },
      ],
    },
    { table: "purchase_orders", select: "id", filters: [{ column: "job_id", value: jobId }] },
    { table: "purchase_orders", select: "id", filters: [{ column: "jobId", value: jobId }] },
  ]);

  if (poResult.error) return { ok: false, error: poResult.error };

  const inventoryResult = await queryVariants(supabase, [
    {
      table: "inventory",
      select: "*",
      filters: [
        { column: "company_id", value: companyId },
        { column: "job_id", value: jobId },
      ],
    },
    {
      table: "inventory",
      select: "*",
      filters: [
        { column: "company_id", value: companyId },
        { column: "jobId", value: jobId },
      ],
    },
    { table: "inventory", select: "*", filters: [{ column: "job_id", value: jobId }] },
    { table: "inventory", select: "*", filters: [{ column: "jobId", value: jobId }] },
  ]);

  if (inventoryResult.error) return { ok: false, error: inventoryResult.error };

  const reportIds = (dailyReportsResult.data ?? [])
    .map((row: Record<string, unknown>) => normalizeId(row.id))
    .filter((id: string | number | null) => id !== null);
  const poIds = (poResult.data ?? [])
    .map((row: Record<string, unknown>) => normalizeId(row.id))
    .filter((id: string | number | null) => id !== null);

  // Exactly one source query per table (variant-resolved):
  // - daily_report_entries
  // - purchase_order_items
  // - inventory (already fetched above)
  const entriesResult = reportIds.length
    ? await queryVariants(supabase, [
        {
          table: "daily_report_entries",
          select: "*",
          filters: [
            { column: "company_id", value: companyId },
            { column: "daily_report_id", value: reportIds, op: "in" },
          ],
        },
        {
          table: "daily_report_entries",
          select: "*",
          filters: [{ column: "daily_report_id", value: reportIds, op: "in" }],
        },
        {
          table: "daily_report_entries",
          select: "*",
          filters: [
            { column: "company_id", value: companyId },
            { column: "report_id", value: reportIds, op: "in" },
          ],
        },
        {
          table: "daily_report_entries",
          select: "*",
          filters: [{ column: "report_id", value: reportIds, op: "in" }],
        },
      ])
    : { data: [] as any[], error: null as string | null };

  if (entriesResult.error) return { ok: false, error: entriesResult.error };

  const poItemsResult = poIds.length
    ? await queryVariants(supabase, [
        {
          table: "purchase_order_items",
          select: "*",
          filters: [
            { column: "company_id", value: companyId },
            { column: "purchase_order_id", value: poIds, op: "in" },
          ],
        },
        {
          table: "purchase_order_items",
          select: "*",
          filters: [{ column: "purchase_order_id", value: poIds, op: "in" }],
        },
        {
          table: "purchase_order_items",
          select: "*",
          filters: [
            { column: "company_id", value: companyId },
            { column: "purchaseOrderId", value: poIds, op: "in" },
          ],
        },
        {
          table: "purchase_order_items",
          select: "*",
          filters: [{ column: "purchaseOrderId", value: poIds, op: "in" }],
        },
      ])
    : { data: [] as any[], error: null as string | null };

  if (poItemsResult.error) return { ok: false, error: poItemsResult.error };

  const entries = entriesResult.data ?? [];

  const employeeIds = Array.from(
    new Set(
      entries
        .filter(
          (entry: Record<string, unknown>) =>
            String(pick(entry, ["entry_type", "entryType"]) ?? "").toLowerCase() === "labor"
        )
        .map((entry: Record<string, unknown>) => normalizeId(pick(entry, ["employee_id", "employeeId"])))
        .filter((id: string | number | null) => id !== null)
    )
  );

  const equipmentIds = Array.from(
    new Set(
      entries
        .filter(
          (entry: Record<string, unknown>) =>
            String(pick(entry, ["entry_type", "entryType"]) ?? "").toLowerCase() === "equipment"
        )
        .map((entry: Record<string, unknown>) => normalizeId(pick(entry, ["equipment_id", "equipmentId"])))
        .filter((id: string | number | null) => id !== null)
    )
  );

  const employeesResult = employeeIds.length
    ? await queryVariants(supabase, [
        {
          table: "employees",
          select: "*",
          filters: [
            { column: "company_id", value: companyId },
            { column: "id", value: employeeIds, op: "in" },
          ],
        },
        { table: "employees", select: "*", filters: [{ column: "id", value: employeeIds, op: "in" }] },
      ])
    : { data: [] as any[], error: null as string | null };

  if (employeesResult.error) return { ok: false, error: employeesResult.error };

  const equipmentResult = equipmentIds.length
    ? await queryVariants(supabase, [
        {
          table: "equipment",
          select: "*",
          filters: [
            { column: "company_id", value: companyId },
            { column: "id", value: equipmentIds, op: "in" },
          ],
        },
        { table: "equipment", select: "*", filters: [{ column: "id", value: equipmentIds, op: "in" }] },
      ])
    : { data: [] as any[], error: null as string | null };

  if (equipmentResult.error) return { ok: false, error: equipmentResult.error };

  const employeeRates = new Map(
    (employeesResult.data ?? []).map((row: Record<string, unknown>) => [
      String(row.id),
      toNumber(pick(row, ["hourly_rate", "hourlyRate", "labor_rate", "laborRate"])),
    ])
  );

  const equipmentRates = new Map(
    (equipmentResult.data ?? []).map((row: Record<string, unknown>) => {
      const hourlyRate = toNumber(pick(row, ["hourly_rate", "hourlyRate"]));
      const dailyRate = toNumber(pick(row, ["daily_rate", "dailyRate"]));
      const resolvedRate = hourlyRate > 0 ? hourlyRate : dailyRate > 0 ? dailyRate / 8 : 0;
      return [String(row.id), resolvedRate];
    })
  );

  let dailyReportLaborCost = 0;
  let dailyReportEquipmentCost = 0;
  let dailyReportMaterialCost = 0;

  const warningsSet = new Set<string>();

  for (const rawEntry of entries) {
    const entry = rawEntry as Record<string, unknown>;
    const entryType = String(pick(entry, ["entry_type", "entryType"]) ?? "").toLowerCase();

    const lineTotal = toNumber(pick(entry, ["total_cost", "totalCost", "line_total", "lineTotal", "amount"]));
    const hours = toNumber(pick(entry, ["hours", "total_hours", "totalHours", "duration_hours", "durationHours"]));
    const quantity = toNumber(pick(entry, ["quantity", "qty", "quantity_used", "quantityUsed", "qty_used", "qtyUsed"]));
    const unitCost = toNumber(pick(entry, ["unit_cost", "unitCost", "cost_per_unit", "costPerUnit", "rate", "hourly_rate", "hourlyRate"]));

    if (entryType === "labor") {
      let laborCost = lineTotal;
      if (laborCost <= 0) {
        const employeeRate = toNumber(
          employeeRates.get(String(normalizeId(pick(entry, ["employee_id", "employeeId"]))))
        );
        laborCost = hours * (employeeRate > 0 ? employeeRate : unitCost);
      }
      if (laborCost <= 0 && hours > 0) {
        warningsSet.add("Some labor entries are missing hourly rates and were treated as $0");
      }
      dailyReportLaborCost += laborCost;
      continue;
    }

    if (entryType === "equipment") {
      let equipmentCost = lineTotal;
      if (equipmentCost <= 0) {
        const equipmentRate = toNumber(
          equipmentRates.get(String(normalizeId(pick(entry, ["equipment_id", "equipmentId"]))))
        );
        equipmentCost = hours * (equipmentRate > 0 ? equipmentRate : unitCost);
      }
      if (equipmentCost <= 0 && hours > 0) {
        warningsSet.add("Some equipment entries are missing hourly rates and were treated as $0");
      }
      dailyReportEquipmentCost += equipmentCost;
      continue;
    }

    if (entryType === "material") {
      const materialCost = lineTotal > 0 ? lineTotal : quantity > 0 && unitCost > 0 ? quantity * unitCost : quantity;
      dailyReportMaterialCost += materialCost;
      if (lineTotal <= 0 && unitCost <= 0 && quantity > 0) {
        warningsSet.add("Material entries without unit cost are treated as direct quantity cost");
      }
    }
  }

  const purchaseOrderItemsCost = (poItemsResult.data ?? []).reduce((sum: number, rawRow: any) => {
    const row = rawRow as Record<string, unknown>;
    const lineTotal = toNumber(pick(row, ["total_cost", "totalCost", "line_total", "lineTotal", "amount"]));
    if (lineTotal > 0) return sum + lineTotal;

    const quantity = toNumber(pick(row, ["quantity", "qty"]));
    const unitCost = toNumber(pick(row, ["unit_cost", "unitCost", "cost_per_unit", "costPerUnit"]));
    return sum + quantity * unitCost;
  }, 0);

  const inventoryUsageCost = (inventoryResult.data ?? []).reduce((sum: number, rawRow: any) => {
    const row = rawRow as Record<string, unknown>;
    const lineTotal = toNumber(pick(row, ["total_cost", "totalCost", "line_total", "lineTotal", "amount"]));
    if (lineTotal > 0) return sum + lineTotal;

    const quantity = toNumber(
      pick(row, ["qty_reserved", "qtyReserved", "quantity_used", "quantityUsed", "qty_used", "qtyUsed", "allocated_qty", "allocatedQty"])
    );
    const unitCost = toNumber(pick(row, ["unit_cost", "unitCost", "avg_cost", "average_cost", "cost_per_unit", "costPerUnit"]));
    return sum + quantity * unitCost;
  }, 0);

  const actualCost = round2(
    dailyReportLaborCost +
      dailyReportEquipmentCost +
      dailyReportMaterialCost +
      purchaseOrderItemsCost +
      inventoryUsageCost
  );

  const estimatedCost = round2(estimateResult.estimatedCost);
  const estimatedRevenue = round2(estimateResult.estimatedRevenue);

  const varianceAmount = round2(actualCost - estimatedCost);
  const variancePercent = estimatedCost > 0 ? round2((varianceAmount / estimatedCost) * 100) : 0;
  const thresholdPercent = 10;
  const isOverBudget = estimatedCost > 0 && variancePercent > thresholdPercent;

  const estimatedMarginPercent =
    estimatedRevenue > 0 ? round2(((estimatedRevenue - estimatedCost) / estimatedRevenue) * 100) : 0;
  const actualMarginPercent =
    estimatedRevenue > 0 ? round2(((estimatedRevenue - actualCost) / estimatedRevenue) * 100) : 0;
  const marginDriftPercent = round2(actualMarginPercent - estimatedMarginPercent);

  if (isOverBudget) {
    warningsSet.add(`Actual cost is ${variancePercent}% over estimated cost`);
  }

  return {
    ok: true,
    summary: {
      jobId,
      estimatedCost,
      estimatedRevenue,
      actualLaborCost: round2(dailyReportLaborCost),
      actualEquipmentCost: round2(dailyReportEquipmentCost),
      actualMaterialCost: round2(
        dailyReportMaterialCost + purchaseOrderItemsCost + inventoryUsageCost
      ),
      actualTotalCost: actualCost,
      actualCost,
      varianceAmount,
      variancePercent,
      thresholdPercent,
      isOverBudget,
      estimatedMarginPercent,
      actualMarginPercent,
      marginDriftPercent,
      breakdown: {
        dailyReportLaborCost: round2(dailyReportLaborCost),
        dailyReportEquipmentCost: round2(dailyReportEquipmentCost),
        dailyReportMaterialCost: round2(dailyReportMaterialCost),
        purchaseOrderItemsCost: round2(purchaseOrderItemsCost),
        inventoryUsageCost: round2(inventoryUsageCost),
      },
      warnings: Array.from(warningsSet),
    },
  };
}
