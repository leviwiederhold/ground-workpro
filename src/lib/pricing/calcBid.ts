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
  id?: string | number | null;
  item_type?: string | null;
  equipment_id?: string | number | null;
  description?: string | null;
  quantity?: number | null;
  unit_cost?: number | null;
  total_cost?: number | null;
};

export type BidExcavationInput = {
  excavation_cy?: number | null;
  production_cy_per_hour?: number | null;
  haul_hours?: number | null;
  truck_capacity_cy?: number | null;
  cycle_time_minutes?: number | null;
  dump_loads?: number | null;
  dump_fee_per_load?: number | null;
  fuel_burn_gph?: number | null;
  fuel_cost_per_gallon?: number | null;
};

export type BidCalcOptions = {
  excavation?: BidExcavationInput | null;
  equipmentHourlyRates?: Record<string, number>;
};

export type BidSummary = {
  itemizedCost: number;
  excavationHours: number;
  haulingHours: number;
  dumpLoads: number;
  equipmentHourlyCost: number;
  haulingCost: number;
  dumpCost: number;
  fuelCost: number;
  contingencyCost: number;
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
  items: BidItemInput[] | null | undefined,
  options?: BidCalcOptions
): BidSummary {
  const sourceItems = items ?? [];
  const excavation = options?.excavation ?? null;
  const equipmentHourlyRates = options?.equipmentHourlyRates ?? {};

  const haulingRatePerHour = normalizeNumber(pricingSettings?.hauling_rate_per_hour, 0);
  const contingencyPercent = normalizeNumber(pricingSettings?.contingency_percent, 0);
  const defaultDumpFeePerLoad = normalizeNumber(pricingSettings?.dump_fee_per_load, 0);
  const markupPercent = normalizeNumber(pricingSettings?.markup_percent, 0);
  const targetMarginPercent = normalizeNumber(pricingSettings?.target_margin_percent, 0);

  const warnings: string[] = [];
  let equipmentHourlyCost = 0;
  let itemizedCost = 0;

  for (const item of sourceItems) {
    const quantity = normalizeNumber(item?.quantity, 0);
    const rawUnitCost = normalizeNumber(item?.unit_cost, 0);
    const explicitTotal = normalizeNumber(item?.total_cost, Number.NaN);
    const itemType = (item?.item_type ?? "").toLowerCase();
    const isEquipment = itemType === "equipment";

    let resolvedUnitCost = rawUnitCost;
    if (isEquipment && resolvedUnitCost <= 0) {
      const equipmentId = item?.equipment_id === null || item?.equipment_id === undefined
        ? ""
        : String(item.equipment_id);
      const hourlyRate = equipmentHourlyRates[equipmentId];
      if (hourlyRate !== undefined && hourlyRate > 0) {
        resolvedUnitCost = hourlyRate;
      } else {
        const label = item?.description ? `"${item.description}"` : (equipmentId ? `ID ${equipmentId}` : "unknown equipment");
        warnings.push(`Missing equipment hourly rate for ${label}`);
      }
    }

    const computedTotal = Number.isNaN(explicitTotal) ? quantity * resolvedUnitCost : explicitTotal;
    itemizedCost += computedTotal;
    if (isEquipment) {
      equipmentHourlyCost += quantity * resolvedUnitCost;
    }
  }

  itemizedCost = round2(itemizedCost);
  equipmentHourlyCost = round2(equipmentHourlyCost);

  const excavationCy = normalizeNumber(excavation?.excavation_cy, 0);
  const productionCyPerHour = normalizeNumber(excavation?.production_cy_per_hour, 0);
  const excavationHours = round2(
    productionCyPerHour > 0 ? excavationCy / productionCyPerHour : 0
  );
  if (excavationCy > 0 && productionCyPerHour <= 0) {
    warnings.push("Missing production rate (CY/hour) for excavation hours");
  }

  const truckCapacityCy = normalizeNumber(excavation?.truck_capacity_cy, 0);
  const cycleTimeMinutes = normalizeNumber(excavation?.cycle_time_minutes, 0);
  const explicitDumpLoads = normalizeNumber(excavation?.dump_loads, Number.NaN);
  const derivedDumpLoads = truckCapacityCy > 0 && excavationCy > 0 ? excavationCy / truckCapacityCy : 0;
  const dumpLoads = round2(Number.isNaN(explicitDumpLoads) ? derivedDumpLoads : explicitDumpLoads);
  if (excavationCy > 0 && Number.isNaN(explicitDumpLoads) && truckCapacityCy <= 0) {
    warnings.push("Missing truck capacity (CY) for dump load calculation");
  }

  const explicitHaulHours = normalizeNumber(excavation?.haul_hours, Number.NaN);
  const derivedHaulHours = dumpLoads > 0 && cycleTimeMinutes > 0 ? (dumpLoads * cycleTimeMinutes) / 60 : 0;
  const haulingHours = round2(Number.isNaN(explicitHaulHours) ? derivedHaulHours : explicitHaulHours);
  if (dumpLoads > 0 && Number.isNaN(explicitHaulHours) && cycleTimeMinutes <= 0) {
    warnings.push("Missing haul cycle time (minutes) for hauling hours");
  }

  const haulingCost = round2(haulingHours * haulingRatePerHour);
  const dumpFeePerLoad = normalizeNumber(excavation?.dump_fee_per_load, defaultDumpFeePerLoad);
  const dumpCost = round2(dumpLoads * dumpFeePerLoad);

  const fuelBurnGph = normalizeNumber(excavation?.fuel_burn_gph, 0);
  const fuelCostPerGallon = normalizeNumber(excavation?.fuel_cost_per_gallon, 0);
  const fuelHours = excavationHours + haulingHours;
  const fuelCost = round2(fuelHours * fuelBurnGph * fuelCostPerGallon);
  if (fuelHours > 0 && fuelBurnGph <= 0) {
    warnings.push("Missing fuel burn rate (GPH) for fuel factor");
  }
  if (fuelHours > 0 && fuelCostPerGallon <= 0) {
    warnings.push("Missing fuel cost per gallon for fuel factor");
  }

  const preContingencyCost = itemizedCost + haulingCost + dumpCost + fuelCost;
  const contingencyCost = round2(preContingencyCost * (contingencyPercent / 100));
  const subtotalCost = round2(preContingencyCost + contingencyCost);

  const revenue = round2(subtotalCost * (1 + markupPercent / 100));
  const profit = round2(revenue - subtotalCost);
  const marginPercent = round2(revenue > 0 ? (profit / revenue) * 100 : 0);
  const isBelowTarget = marginPercent < targetMarginPercent;

  if (isBelowTarget) {
    warnings.push(`Margin ${marginPercent}% is below target ${targetMarginPercent}%`);
  }

  return {
    itemizedCost,
    excavationHours,
    haulingHours,
    dumpLoads,
    equipmentHourlyCost,
    haulingCost,
    dumpCost,
    fuelCost,
    contingencyCost,
    subtotalCost,
    revenue,
    profit,
    marginPercent,
    targetMarginPercent,
    isBelowTarget,
    warnings,
  };
}
