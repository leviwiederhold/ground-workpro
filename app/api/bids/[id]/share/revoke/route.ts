/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { requireActiveSubscription } from "@/lib/billing/requireActiveSubscription";
import { logAuditEvent } from "@/lib/audit/logAuditEvent";
import { okItem } from "@/lib/http/json";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
const ROUTE = "/api/bids/[id]/share/revoke";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const toValidationDetails = (error: any) =>
  error.issues.map((issue: any) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));

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
  let context: { companyId?: string; userId?: string; role?: string } = {};
  try {
    const rawParams = await params;
    const parsedParams = paramsSchema.safeParse(rawParams);
    if (!parsedParams.success) {
      return validationError(toValidationDetails(parsedParams.error));
    }

    try {
      const access = await requireRole(["admin", "pm"]);
      context = { companyId: access.companyId, userId: access.userId, role: access.role };
    } catch {
      return forbidden();
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
      return serverError("Internal server error", undefined, { route: ROUTE, ...context });
    }
    if (!bid) {
      return notFound("Bid not found");
    }

    const { data: shareLink, error: shareError } = await loadLatestActiveShareLink(supabase, companyId, bidId);
    if (shareError) {
      return serverError("Internal server error", undefined, { route: ROUTE, ...context });
    }
    if (!shareLink) {
      return notFound("Share link not found");
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
      return serverError("Internal server error", undefined, { route: ROUTE, ...context });
    }
    if (!updated) {
      return serverError("Internal server error", undefined, { route: ROUTE, ...context });
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

    return okItem({ success: true });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      if (error.status === 404) return notFound(error.message);
      if (error.status === 403) return forbidden(error.message);
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return serverError("Internal server error", undefined, { route: ROUTE, ...context });
  }
}
