/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { calcBid } from "@/lib/pricing/calcBid";

const normalizeRouteId = (id: string) => (/^\d+$/.test(id) ? Number(id) : id);
const paramsSchema = z.object({ id: z.string().min(1) });
const EXCAVATION_NOTES_MARKER = "__excavation_inputs_json__:";

const normalizeNumber = (value: unknown, fallback = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

async function fetchBidRow(supabase: any, companyId: string, bidId: string | number) {
  const result = await supabase
    .from("bids")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", bidId)
    .maybeSingle();
  return result;
}

async function fetchBidItems(supabase: any, companyId: string, bidId: string | number) {
  let result = await supabase
    .from("bid_items")
    .select("*")
    .eq("company_id", companyId)
    .eq("bid_id", bidId);

  if (result.error?.message?.toLowerCase().includes("company_id")) {
    result = await supabase
      .from("bid_items")
      .select("*")
      .eq("bid_id", bidId);
  }

  if (result.error?.message?.toLowerCase().includes("bid_id")) {
    result = await supabase
      .from("bid_items")
      .select("*")
      .eq("bidId", bidId);
    if (result.error?.message?.toLowerCase().includes("company_id")) {
      result = await supabase
        .from("bid_items")
        .select("*")
        .eq("bidId", bidId);
    }
  }

  return result;
}

async function fetchEquipmentRates(supabase: any, companyId: string, equipmentIds: Array<string | number>) {
  if (equipmentIds.length === 0) return {};

  let result = await supabase
    .from("equipment")
    .select("id, name, hourly_rate, daily_rate")
    .eq("company_id", companyId)
    .in("id", equipmentIds);

  if (result.error?.message?.toLowerCase().includes("company_id")) {
    result = await supabase
      .from("equipment")
      .select("id, name, hourly_rate, daily_rate")
      .in("id", equipmentIds);
  }

  if (result.error?.message?.includes("Could not find the")) {
    result = await supabase
      .from("equipment")
      .select("id, name, daily_rate")
      .eq("company_id", companyId)
      .in("id", equipmentIds);
  }

  if (result.error?.message?.includes("Could not find the")) {
    result = await supabase
      .from("equipment")
      .select("id, name")
      .eq("company_id", companyId)
      .in("id", equipmentIds);
  }

  if (result.error) {
    return { error: result.error.message, rates: {} as Record<string, number> };
  }

  const rates = (result.data ?? []).reduce((acc: Record<string, number>, row: any) => {
    const hourlyRate = normalizeNumber(row.hourly_rate, Number.NaN);
    const dailyRate = normalizeNumber(row.daily_rate, Number.NaN);
    if (!Number.isNaN(hourlyRate) && hourlyRate > 0) {
      acc[String(row.id)] = hourlyRate;
      return acc;
    }
    if (!Number.isNaN(dailyRate) && dailyRate > 0) {
      acc[String(row.id)] = dailyRate / 8;
    }
    return acc;
  }, {});

  return { rates };
}

function readExcavationInputsFromNotes(notesValue: unknown) {
  if (typeof notesValue !== "string" || !notesValue) return {};
  const markerLine = notesValue
    .split("\n")
    .find((line) => line.startsWith(EXCAVATION_NOTES_MARKER));
  if (!markerLine) return {};
  const raw = markerLine.slice(EXCAVATION_NOTES_MARKER.length);
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const routeParams = await params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      return NextResponse.json(
        {
          error: "Validation error",
          details: parsedParams.error.issues.map((issue: { path: Array<string | number>; message: string }) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 422 }
      );
    }

    const { id } = parsedParams.data;
    const bidId = normalizeRouteId(id);
    const { supabase, companyId } = await getCompanyId();

    const { data: bidRow, error: bidError } = await fetchBidRow(supabase, companyId, bidId);

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

    const safePricingSettings =
      pricingError && !pricingError.message.toLowerCase().includes("does not exist")
        ? null
        : (pricingSettings ?? null);

    const { data: bidItems, error: itemsError } = await fetchBidItems(supabase, companyId, bidId);

    const safeBidItems = itemsError ? [] : (bidItems ?? []);

    const equipmentIds = safeBidItems
      .filter((item: any) => (item?.item_type ?? "").toLowerCase() === "equipment")
      .map((item: any) => item?.equipment_id)
      .filter((idValue: unknown) => idValue !== null && idValue !== undefined && idValue !== "")
      .map((idValue: unknown) => (typeof idValue === "string" && /^\d+$/.test(idValue) ? Number(idValue) : idValue));

    const equipmentRatesResult = await fetchEquipmentRates(
      supabase,
      companyId,
      Array.from(new Set(equipmentIds))
    );
    const equipmentRates = "error" in equipmentRatesResult ? {} : equipmentRatesResult.rates;

    const notesExcavation = readExcavationInputsFromNotes(bidRow?.notes);
    const excavation = { ...notesExcavation, ...bidRow };

    const summary = calcBid(safePricingSettings, safeBidItems, {
      excavation,
      equipmentHourlyRates: equipmentRates,
    });

    return NextResponse.json({ summary });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
