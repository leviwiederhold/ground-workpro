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

type JobCostSummary = {
  jobId: string | number;
  estimatedCost: number;
  estimatedRevenue: number;
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
  let bidResult = await supabase
    .from("bids")
    .select("*")
    .eq("company_id", companyId)
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (bidResult.error?.message?.toLowerCase().includes("job_id")) {
    bidResult = await supabase
      .from("bids")
      .select("*")
      .eq("company_id", companyId)
      .eq("jobId", jobId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
  }

  if (bidResult.error?.message?.toLowerCase().includes("created_at")) {
    bidResult = await supabase
      .from("bids")
      .select("*")
      .eq("company_id", companyId)
      .eq("job_id", jobId)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (bidResult.error?.message?.toLowerCase().includes("job_id")) {
      bidResult = await supabase
        .from("bids")
        .select("*")
        .eq("company_id", companyId)
        .eq("jobId", jobId)
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
    }
  }

  if (bidResult.error) {
    return { error: bidResult.error.message };
  }
  if (!bidResult.data) {
    return { bidId: null as string | number | null, estimatedCost: 0, estimatedRevenue: 0 };
  }

  const bidId = normalizeId(bidResult.data.id);
  if (bidId === null) {
    return { bidId: null as string | number | null, estimatedCost: 0, estimatedRevenue: 0 };
  }

  const { data: bidItems, error: itemsError } = await supabase
    .from("bid_items")
    .select("*")
    .eq("company_id", companyId)
    .eq("bid_id", bidId);

  if (itemsError?.message?.toLowerCase().includes("company_id")) {
    const withoutCompany = await supabase
      .from("bid_items")
      .select("*")
      .eq("bid_id", bidId);
    if (!withoutCompany.error) {
      const estimateFromSummary = calcBid(null, withoutCompany.data ?? []);
      const estimatedCost =
        toNumber((bidResult.data as any).subtotal) > 0
          ? round2(toNumber((bidResult.data as any).subtotal))
          : round2(estimateFromSummary.subtotalCost);
      const estimatedRevenue =
        toNumber((bidResult.data as any).total) > 0
          ? round2(toNumber((bidResult.data as any).total))
          : toNumber((bidResult.data as any).amount) > 0
          ? round2(toNumber((bidResult.data as any).amount))
          : round2(estimateFromSummary.revenue);
      return { bidId, estimatedCost, estimatedRevenue };
    }
  }

  if (itemsError?.message?.toLowerCase().includes("bid_id")) {
    const fallbackItems = await supabase
      .from("bid_items")
      .select("*")
      .eq("company_id", companyId)
      .eq("bidId", bidId);
    if (fallbackItems.error) {
      return { error: fallbackItems.error.message };
    }
    const estimateFromSummary = calcBid(null, fallbackItems.data ?? []);
    const estimatedCost =
      toNumber((bidResult.data as any).subtotal) > 0
        ? round2(toNumber((bidResult.data as any).subtotal))
        : round2(estimateFromSummary.subtotalCost);
    const estimatedRevenue =
      toNumber((bidResult.data as any).total) > 0
        ? round2(toNumber((bidResult.data as any).total))
        : toNumber((bidResult.data as any).amount) > 0
        ? round2(toNumber((bidResult.data as any).amount))
        : round2(estimateFromSummary.revenue);
    return { bidId, estimatedCost, estimatedRevenue };
  }

  if (itemsError) {
    return { error: itemsError.message };
  }

  const estimateFromSummary = calcBid(null, bidItems ?? []);
  const estimatedCost =
    toNumber(bidResult.data.subtotal) > 0
      ? round2(toNumber(bidResult.data.subtotal))
      : round2(estimateFromSummary.subtotalCost);

  const estimatedRevenue =
    toNumber(bidResult.data.total) > 0
      ? round2(toNumber(bidResult.data.total))
      : toNumber(bidResult.data.amount) > 0
      ? round2(toNumber(bidResult.data.amount))
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
    return { ok: false, error: estimateResult.error };
  }

  const [dailyReportsResult, poResult, inventoryResult] = await Promise.all([
    (async () => {
      const primary = await supabase
        .from("daily_reports")
        .select("id")
        .eq("company_id", companyId)
        .eq("job_id", jobId);
      if (primary.error) {
        const companyMessage = String(primary.error.message || "").toLowerCase();
        if (companyMessage.includes("company_id")) {
          const withoutCompany = await supabase
            .from("daily_reports")
            .select("id")
            .eq("job_id", jobId);
          if (!withoutCompany.error) return withoutCompany;
        }
      }
      if (!primary.error) return primary;
      const message = String(primary.error.message || "").toLowerCase();
      if (!message.includes("job_id")) return primary;
      const fallback = await supabase
        .from("daily_reports")
        .select("id")
        .eq("jobId", jobId);
      if (!fallback.error) return fallback;
      if (String(fallback.error.message || "").toLowerCase().includes("company_id")) {
        return supabase
          .from("daily_reports")
          .select("id")
          .eq("jobId", jobId);
      }
      return fallback;
    })(),
    (async () => {
      const primary = await supabase
        .from("purchase_orders")
        .select("id")
        .eq("company_id", companyId)
        .eq("job_id", jobId);
      if (primary.error) {
        const companyMessage = String(primary.error.message || "").toLowerCase();
        if (companyMessage.includes("company_id")) {
          const withoutCompany = await supabase
            .from("purchase_orders")
            .select("id")
            .eq("job_id", jobId);
          if (!withoutCompany.error) return withoutCompany;
        }
      }
      if (!primary.error) return primary;
      const message = String(primary.error.message || "").toLowerCase();
      if (!message.includes("job_id")) return primary;
      const fallback = await supabase
        .from("purchase_orders")
        .select("id")
        .eq("jobId", jobId);
      if (!fallback.error) return fallback;
      if (String(fallback.error.message || "").toLowerCase().includes("company_id")) {
        return supabase
          .from("purchase_orders")
          .select("id")
          .eq("jobId", jobId);
      }
      return fallback;
    })(),
    (async () => {
      const primary = await supabase
        .from("inventory")
        .select("*")
        .eq("company_id", companyId)
        .eq("job_id", jobId);
      if (primary.error) {
        const companyMessage = String(primary.error.message || "").toLowerCase();
        if (companyMessage.includes("company_id")) {
          const withoutCompany = await supabase
            .from("inventory")
            .select("*")
            .eq("job_id", jobId);
          if (!withoutCompany.error) return withoutCompany;
          const withoutCompanyJobId = await supabase
            .from("inventory")
            .select("*")
            .eq("jobId", jobId);
          if (!withoutCompanyJobId.error) return withoutCompanyJobId;
          const withoutCompanyMessage = String(withoutCompany.error?.message || "").toLowerCase();
          const withoutCompanyJobIdMessage = String(
            withoutCompanyJobId.error?.message || ""
          ).toLowerCase();
          if (
            (withoutCompanyMessage.includes("job_id") ||
              withoutCompanyMessage.includes("jobid")) &&
            (withoutCompanyJobIdMessage.includes("job_id") ||
              withoutCompanyJobIdMessage.includes("jobid"))
          ) {
            return { data: [], error: null };
          }
        }
      }
      if (!primary.error) return primary;
      const message = String(primary.error.message || "").toLowerCase();
      if (!message.includes("job_id") && !message.includes("jobid")) return primary;
      const fallback = await supabase
        .from("inventory")
        .select("*")
        .eq("jobId", jobId);
      if (!fallback.error) return fallback;
      if (String(fallback.error.message || "").toLowerCase().includes("company_id")) {
        const fallbackWithoutCompany = await supabase
          .from("inventory")
          .select("*")
          .eq("jobId", jobId);
        if (!fallbackWithoutCompany.error) return fallbackWithoutCompany;
        const fallbackWithoutCompanyMessage = String(
          fallbackWithoutCompany.error?.message || ""
        ).toLowerCase();
        if (
          fallbackWithoutCompanyMessage.includes("job_id") ||
          fallbackWithoutCompanyMessage.includes("jobid")
        ) {
          return { data: [], error: null };
        }
        return fallbackWithoutCompany;
      }
      const fallbackMessage = String(fallback.error.message || "").toLowerCase();
      if (fallbackMessage.includes("job_id") || fallbackMessage.includes("jobid")) {
        return { data: [], error: null };
      }
      return fallback;
    })(),
  ]);

  if (dailyReportsResult.error) return { ok: false, error: dailyReportsResult.error.message };
  if (poResult.error) return { ok: false, error: poResult.error.message };
  if (inventoryResult.error) return { ok: false, error: inventoryResult.error.message };

  const reportIds = (dailyReportsResult.data ?? [])
    .map((row: any) => normalizeId(row.id))
    .filter((id: string | number | null) => id !== null);
  const poIds = (poResult.data ?? [])
    .map((row: any) => normalizeId(row.id))
    .filter((id: string | number | null) => id !== null);

  const [entriesResult, poItemsResult] = await Promise.all([
    reportIds.length > 0
      ? (async () => {
          const primary = await supabase
            .from("daily_report_entries")
            .select("*")
            .eq("company_id", companyId)
            .in("daily_report_id", reportIds);
          if (primary.error) {
            const companyMessage = String(primary.error.message || "").toLowerCase();
            if (companyMessage.includes("company_id")) {
              const withoutCompany = await supabase
                .from("daily_report_entries")
                .select("*")
                .in("daily_report_id", reportIds);
              if (!withoutCompany.error) return withoutCompany;
            }
          }
          if (!primary.error) return primary;
          const message = String(primary.error.message || "").toLowerCase();
          if (!message.includes("daily_report_id")) return primary;
          const fallback = await supabase
            .from("daily_report_entries")
            .select("*")
            .in("report_id", reportIds);
          if (!fallback.error) return fallback;
          if (String(fallback.error.message || "").toLowerCase().includes("company_id")) {
            return supabase
              .from("daily_report_entries")
              .select("*")
              .in("report_id", reportIds);
          }
          return fallback;
        })()
      : Promise.resolve({ data: [], error: null }),
    poIds.length > 0
      ? supabase
          .from("purchase_order_items")
          .select("*")
          .eq("company_id", companyId)
          .in("purchase_order_id", poIds)
          .then(async (result: any) => {
            if (!result.error) return result;
            const message = String(result.error.message || "").toLowerCase();
            if (!message.includes("purchase_order_id")) return result;
            return supabase
              .from("purchase_order_items")
              .select("*")
              .eq("company_id", companyId)
              .in("purchaseOrderId", poIds);
          })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (entriesResult.error) return { ok: false, error: entriesResult.error.message };
  if (poItemsResult.error) return { ok: false, error: poItemsResult.error.message };

  const entries = entriesResult.data ?? [];
  const employeeIds = Array.from(
    new Set(
      entries
        .filter(
          (entry: any) =>
            String(entry.entry_type ?? entry.entryType ?? "").toLowerCase() === "labor"
        )
        .map((entry: any) => normalizeId(entry.employee_id ?? entry.employeeId))
        .filter((id: string | number | null) => id !== null)
    )
  );
  const equipmentIds = Array.from(
    new Set(
      entries
        .filter(
          (entry: any) =>
            String(entry.entry_type ?? entry.entryType ?? "").toLowerCase() === "equipment"
        )
        .map((entry: any) => normalizeId(entry.equipment_id ?? entry.equipmentId))
        .filter((id: string | number | null) => id !== null)
    )
  );

  const [employeesResult, equipmentResult] = await Promise.all([
    employeeIds.length > 0
      ? supabase
          .from("employees")
          .select("*")
          .eq("company_id", companyId)
          .in("id", employeeIds)
      : Promise.resolve({ data: [], error: null }),
    equipmentIds.length > 0
      ? supabase
          .from("equipment")
          .select("*")
          .eq("company_id", companyId)
          .in("id", equipmentIds)
          .then(async (result: any) => {
            if (!result.error) return result;
            const message = String(result.error.message || "").toLowerCase();
            if (!message.includes("company_id")) return result;
            return supabase
              .from("equipment")
              .select("*")
              .in("id", equipmentIds);
          })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (employeesResult.error) return { ok: false, error: employeesResult.error.message };
  if (equipmentResult.error) return { ok: false, error: equipmentResult.error.message };

  const employeeRates = new Map(
    (employeesResult.data ?? []).map((row: any) => [
      String(row.id),
      toNumber(row.hourly_rate ?? row.hourlyRate),
    ])
  );
  const equipmentRates = new Map(
    (equipmentResult.data ?? []).map((row: any) => {
      const hourlyRate = toNumber(row.hourly_rate ?? row.hourlyRate);
      const dailyRate = toNumber(row.daily_rate ?? row.dailyRate);
      const resolvedRate = hourlyRate > 0 ? hourlyRate : dailyRate > 0 ? dailyRate / 8 : 0;
      return [String(row.id), resolvedRate];
    })
  );

  let dailyReportLaborCost = 0;
  let dailyReportEquipmentCost = 0;
  let dailyReportMaterialCost = 0;

  for (const entry of entries) {
    const entryType = String(entry.entry_type ?? entry.entryType ?? "").toLowerCase();
    const entryHours = toNumber(entry.hours ?? entry.total_hours ?? entry.totalHours);
    if (entryType === "labor") {
      dailyReportLaborCost +=
        entryHours *
        toNumber(
          employeeRates.get(String(normalizeId(entry.employee_id ?? entry.employeeId)))
        );
      continue;
    }
    if (entryType === "equipment") {
      dailyReportEquipmentCost +=
        entryHours *
        toNumber(
          equipmentRates.get(String(normalizeId(entry.equipment_id ?? entry.equipmentId)))
        );
      continue;
    }
    if (entryType === "material") {
      dailyReportMaterialCost += toNumber(entry.quantity ?? entry.qty);
    }
  }

  const purchaseOrderItemsCost = (poItemsResult.data ?? []).reduce(
    (sum: number, row: any) =>
      sum + toNumber(row.quantity) * toNumber(row.unit_cost ?? row.unitPrice),
    0
  );
  const inventoryUsageCost = (inventoryResult.data ?? []).reduce(
    (sum: number, row: any) =>
      sum +
      toNumber(row.qty_reserved ?? row.qtyReserved) *
        toNumber(row.unit_cost ?? row.unitCost),
    0
  );

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

  const warnings: string[] = [];
  if (isOverBudget) {
    warnings.push(`Actual cost is ${variancePercent}% over estimated cost`);
  }
  if (dailyReportMaterialCost > 0) {
    warnings.push("Material entry quantities are used as a direct cost proxy");
  }

  return {
    ok: true,
    summary: {
      jobId,
      estimatedCost,
      estimatedRevenue,
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
      warnings,
    },
  };
}
