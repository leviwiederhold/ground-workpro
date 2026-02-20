/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";

const paramsSchema = z.object({
  id: z.string().uuid(),
});
const EXCAVATION_NOTES_MARKER = "__excavation_inputs_json__:";

const excavationSchema = z
  .object({
    excavation_cy: z.number().nonnegative().optional(),
    production_cy_per_hour: z.number().positive().optional(),
    haul_hours: z.number().nonnegative().optional(),
    truck_capacity_cy: z.number().positive().optional(),
    cycle_time_minutes: z.number().positive().optional(),
    dump_loads: z.number().nonnegative().optional(),
    dump_fee_per_load: z.number().nonnegative().optional(),
    fuel_burn_gph: z.number().nonnegative().optional(),
    fuel_cost_per_gallon: z.number().nonnegative().optional(),
  })
  .refine((value: Record<string, unknown>) => Object.keys(value).length > 0, {
    message: "At least one excavation field is required",
  });

async function updateWithColumnFallback(
  supabase: any,
  companyId: string,
  bidId: string,
  payload: Record<string, unknown>
) {
  const currentPayload = { ...payload };
  if (Object.keys(currentPayload).length === 0) {
    return { data: null, error: null };
  }
  let lastResult: any = null;

  for (let i = 0; i < 20; i += 1) {
    const result = await supabase
      .from("bids")
      .update(currentPayload)
      .eq("company_id", companyId)
      .eq("id", bidId)
      .select("*")
      .maybeSingle();

    lastResult = result;
    const message = result.error?.message || "";
    const match = message.match(/Could not find the '([^']+)' column/);
    if (!match) {
      return result;
    }
    const missingColumn = match[1];
    if (!(missingColumn in currentPayload)) {
      return result;
    }
    delete currentPayload[missingColumn];
  }

  return lastResult;
}

function upsertExcavationNotes(existingNotes: unknown, payload: Record<string, unknown>) {
  const normalizedNotes = typeof existingNotes === "string" ? existingNotes : "";
  const withoutMarker = normalizedNotes
    .split("\n")
    .filter((line) => !line.startsWith(EXCAVATION_NOTES_MARKER))
    .join("\n")
    .trim();
  const markerLine = `${EXCAVATION_NOTES_MARKER}${JSON.stringify(payload)}`;
  return withoutMarker ? `${withoutMarker}\n${markerLine}` : markerLine;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    try {
      await requireRole(["admin", "pm"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsedBody = excavationSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        {
          error: "Validation error",
          details: parsedBody.error.issues.map((issue: { path: Array<string | number>; message: string }) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 422 }
      );
    }

    const { supabase, companyId } = await getCompanyId();
    const bidId = parsedParams.data.id;

    const { data: existingBid, error: existingBidError } = await supabase
      .from("bids")
      .select("id, notes")
      .eq("company_id", companyId)
      .eq("id", bidId)
      .maybeSingle();

    if (existingBidError) {
      return NextResponse.json({ error: existingBidError.message }, { status: 400 });
    }

    if (!existingBid) {
      return NextResponse.json({ error: "Bid not found" }, { status: 404 });
    }

    const updateResult = await updateWithColumnFallback(
      supabase,
      companyId,
      bidId,
      parsedBody.data as Record<string, unknown>
    );

    if (updateResult.error) {
      return NextResponse.json({ error: updateResult.error.message }, { status: 400 });
    }

    const notesUpdate = await supabase
      .from("bids")
      .update({
        notes: upsertExcavationNotes(existingBid.notes, parsedBody.data as Record<string, unknown>),
      })
      .eq("company_id", companyId)
      .eq("id", bidId);

    if (notesUpdate.error) {
      return NextResponse.json({ error: notesUpdate.error.message }, { status: 400 });
    }

    return NextResponse.json({
      item: updateResult.data ?? { id: bidId, ...(parsedBody.data as Record<string, unknown>) },
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
