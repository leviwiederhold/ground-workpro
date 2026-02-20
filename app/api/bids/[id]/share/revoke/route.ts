/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { requireActiveSubscription } from "@/lib/billing/requireActiveSubscription";
import { logAuditEvent } from "@/lib/audit/logAuditEvent";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const toValidationError = (error: any) => ({
  error: "Validation error",
  details: error.issues.map((issue: any) => ({
    path: issue.path.join("."),
    message: issue.message,
  })),
});

async function loadLatestActiveShareLink(supabase: any, companyId: string, bidId: string) {
  const nowIso = new Date().toISOString();
  return supabase
    .from("bid_share_links")
    .select("id")
    .eq("company_id", companyId)
    .eq("bid_id", bidId)
    .is("revoked_at", null)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rawParams = await params;
    const parsedParams = paramsSchema.safeParse(rawParams);
    if (!parsedParams.success) {
      return NextResponse.json(toValidationError(parsedParams.error), { status: 422 });
    }

    try {
      await requireRole(["admin", "pm"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { supabase, companyId, userId } = await getCompanyId();
    const bidId = parsedParams.data.id;
    const subscriptionError = await requireActiveSubscription(supabase, companyId);
    if (subscriptionError) {
      return subscriptionError;
    }

    const { data: bid, error: bidError } = await supabase
      .from("bids")
      .select("id")
      .eq("company_id", companyId)
      .eq("id", bidId)
      .maybeSingle();

    if (bidError) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    if (!bid) {
      return NextResponse.json({ error: "Bid not found" }, { status: 404 });
    }

    const { data: shareLink, error: shareError } = await loadLatestActiveShareLink(supabase, companyId, bidId);
    if (shareError) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    if (!shareLink) {
      return NextResponse.json({ error: "Share link not found" }, { status: 404 });
    }

    const revokedAt = new Date().toISOString();
    const { data: updated, error: updateError } = await supabase
      .from("bid_share_links")
      .update({ revoked_at: revokedAt })
      .eq("company_id", companyId)
      .eq("id", shareLink.id)
      .is("revoked_at", null)
      .select("id")
      .maybeSingle();

    if (updateError) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    if (!updated) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    await logAuditEvent({
      supabase,
      companyId,
      actorUserId: userId,
      eventType: "bid.share.revoked",
      entityType: "bid",
      entityId: bidId,
      metadata: { share_link_id: shareLink.id },
    });

    return NextResponse.json({ item: { success: true } });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
