/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { calcBid } from "@/lib/pricing/calcBid";
import { requireActiveSubscription } from "@/lib/billing/requireActiveSubscription";
import { logAuditEvent } from "@/lib/audit/logAuditEvent";
import { errorResponse } from "@/lib/http/errorResponse";

const ROUTE = "/api/bids/[id]/send";

const sendSchema = z.object({
  override: z.boolean().optional().default(false),
  override_note: z.string().optional(),
});

const normalizeRouteId = (id: string) => (/^\d+$/.test(id) ? Number(id) : id);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let context: { companyId?: string; userId?: string; role?: string } = {};
  try {
    try {
      const access = await requireRole(["admin", "pm"]);
      context = { companyId: access.companyId, userId: access.userId, role: access.role };
    } catch {
      return errorResponse("Forbidden", 403);
    }

    const { id } = await params;
    const bidId = normalizeRouteId(id);

    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const parsed = sendSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid send payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { override, override_note } = parsed.data;
    const { supabase, companyId, userId } = await getCompanyId();
    const subscriptionError = await requireActiveSubscription(supabase, companyId);
    if (subscriptionError) {
      return subscriptionError;
    }

    const { data: bidRow, error: bidError } = await supabase
      .from("bids")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", bidId)
      .maybeSingle();

    if (bidError) {
      return errorResponse(bidError.message, 400);
    }
    if (!bidRow) {
      return errorResponse("Bid not found", 404);
    }

    const { data: pricingSettings, error: pricingError } = await supabase
      .from("pricing_settings")
      .select("*")
      .eq("company_id", companyId)
      .maybeSingle();

    if (pricingError && !pricingError.message.toLowerCase().includes("does not exist")) {
      return errorResponse(pricingError.message, 400);
    }

    const { data: bidItems, error: itemsError } = await supabase
      .from("bid_items")
      .select("item_type, quantity, unit_cost, total_cost")
      .eq("company_id", companyId)
      .eq("bid_id", bidId);

    if (itemsError) {
      return errorResponse(itemsError.message, 400);
    }

    const summary = calcBid(pricingSettings ?? null, bidItems ?? []);

    if (summary.isBelowTarget && !override) {
      return NextResponse.json(
        { error: "Margin below target", summary },
        { status: 409 }
      );
    }

    const updatePayload: Record<string, unknown> = {
      status: "sent",
      sent_at: new Date().toISOString(),
      margin_override_acknowledged: !!override,
      margin_override_note: override ? (override_note || "") : null,
    };

    const currentPayload = { ...updatePayload };
    let updateResult: any = null;

    for (let i = 0; i < 20; i += 1) {
      const result = await supabase
        .from("bids")
        .update(currentPayload)
        .eq("company_id", companyId)
        .eq("id", bidId)
        .select("*")
        .single();

      updateResult = result;
      const message = result.error?.message || "";
      const match = message.match(/Could not find the '([^']+)' column/);
      if (!match) break;
      const missingColumn = match[1];
      if (!(missingColumn in currentPayload)) break;
      delete currentPayload[missingColumn];
    }

    if (updateResult?.error) {
      return errorResponse(updateResult.error.message, 400);
    }

    await logAuditEvent({
      supabase,
      companyId,
      actorUserId: userId,
      eventType: "bid.sent",
      entityType: "bid",
      entityId: bidId,
      before: {
        status: bidRow.status ?? null,
        sent_at: bidRow.sent_at ?? null,
        margin_override_acknowledged: bidRow.margin_override_acknowledged ?? false,
        margin_override_note: bidRow.margin_override_note ?? null,
      },
      after: {
        status: updateResult.data?.status ?? "sent",
        sent_at: updateResult.data?.sent_at ?? null,
        margin_override_acknowledged: updateResult.data?.margin_override_acknowledged ?? !!override,
        margin_override_note: updateResult.data?.margin_override_note ?? (override ? (override_note || "") : null),
      },
      metadata: {
        override: !!override,
        override_note: override ? (override_note || "") : null,
        marginPercent: summary.marginPercent,
        targetMarginPercent: summary.targetMarginPercent,
      },
    });

    return NextResponse.json({ bid: updateResult.data, summary });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return errorResponse(error.message, error.status);
    }
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(message || "Unexpected server error", 500, {
      context: {
        route: ROUTE,
        ...context,
      },
    });
  }
}
