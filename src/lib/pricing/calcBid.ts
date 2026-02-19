export type PricingSettingsInput = {
  operator_labor_rate?: number | null;
  labor_burden_percent?: number | null;
  hauling_rate_per_hour?: number | null;
  dump_fee_per_load?: number | null;
  target_margin_percent?: number | null;
  contingency_percent?: number | null;
  markup_percent?: number | null;
};

export type BidItemInput = {
  item_type?: string | null;
  quantity?: number | null;
  unit_cost?: number | null;
  total_cost?: number | null;
};

export type BidSummary = {
  subtotalCost: number;
  revenue: number;
  profit: number;
  marginPercent: number;
  targetMarginPercent: number;
  isBelowTarget: boolean;
  warnings: string[];
};

const normalizeNumber = (value: unknown, fallback = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

export function calcBid(
  pricingSettings: PricingSettingsInput | null | undefined,
  items: BidItemInput[] | null | undefined
): BidSummary {
  const sourceItems = items ?? [];
  const markupPercent = normalizeNumber(pricingSettings?.markup_percent, 0);
  const targetMarginPercent = normalizeNumber(pricingSettings?.target_margin_percent, 0);

  const subtotalCost = round2(
    sourceItems.reduce((sum, item) => {
      const explicitTotal = normalizeNumber(item?.total_cost, Number.NaN);
      if (!Number.isNaN(explicitTotal)) return sum + explicitTotal;
      const quantity = normalizeNumber(item?.quantity, 0);
      const unitCost = normalizeNumber(item?.unit_cost, 0);
      return sum + (quantity * unitCost);
    }, 0)
  );

  const revenue = round2(subtotalCost * (1 + markupPercent / 100));
  const profit = round2(revenue - subtotalCost);
  const marginPercent = round2(revenue > 0 ? (profit / revenue) * 100 : 0);
  const isBelowTarget = marginPercent < targetMarginPercent;
  const warnings: string[] = [];

  if (isBelowTarget) {
    warnings.push(`Margin ${marginPercent}% is below target ${targetMarginPercent}%`);
  }

  return {
    subtotalCost,
    revenue,
    profit,
    marginPercent,
    targetMarginPercent,
    isBelowTarget,
    warnings,
  };
}
