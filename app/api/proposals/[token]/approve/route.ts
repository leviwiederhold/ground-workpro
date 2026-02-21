/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "next/dist/compiled/zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getPublicProposalByToken } from "@/lib/proposals/publicProposal";
import { requireActiveSubscription } from "@/lib/billing/requireActiveSubscription";
import { logAuditEvent } from "@/lib/audit/logAuditEvent";
import { errorResponse } from "@/lib/http/errorResponse";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { enqueueOutboxEvent } from "@/lib/outbox/queue";
const ROUTE = "/api/proposals/[token]/approve";

const paramsSchema = z.object({
  token: z.string().min(24),
});

const toValidationError = (error: any) => ({
  error: "Validation error",
  details: error.issues.map((issue: any) => ({
    path: issue.path.join("."),
    message: issue.message,
  })),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  let context: { companyId?: string; userId?: string; role?: string } = {};
  const rateLimited = enforceRateLimit(request, {
    keyPrefix: "proposal-approve",
    limit: 120,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  try {
    const rawParams = await params;
    const parsedParams = paramsSchema.safeParse(rawParams);
    if (!parsedParams.success) {
      return errorResponse("Validation error", 422, {
        details: toValidationError(parsedParams.error).details,
      });
    }

    const proposalResult = await getPublicProposalByToken(parsedParams.data.token);
    if (!proposalResult.ok) {
      return errorResponse(proposalResult.error, proposalResult.status);
    }
    context = {
      companyId: proposalResult.companyId,
      userId: proposalResult.shareCreatedByUserId ?? undefined,
      role: "public_token",
    };

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return errorResponse("Internal server error", 500, {
        context: { route: ROUTE, ...context },
      });
    }

    const subscriptionError = await requireActiveSubscription(supabase, proposalResult.companyId);
    if (subscriptionError) {
      return subscriptionError;
    }

    const status = String(proposalResult.status || "").toLowerCase();
    if (status === "accepted") {
      return errorResponse("Proposal already accepted", 409);
    }
    if (status !== "sent") {
      return errorResponse("Bid must be sent before approval", 409);
    }

    const now = new Date().toISOString();
    const basePayload = {
      status: "accepted",
      accepted_at: now,
    };

    let updateResult: any = null;
    const updatePayload: Record<string, unknown> = { ...basePayload };
    for (let i = 0; i < 10; i += 1) {
      const result = await supabase
        .from("bids")
        .update(updatePayload)
        .eq("company_id", proposalResult.companyId)
        .eq("id", proposalResult.bidId)
        .eq("status", "sent")
        .select("id")
        .maybeSingle();

      updateResult = result;
      const message = result.error?.message || "";
      const match = message.match(/Could not find the '([^']+)' column/);
      if (!match) break;
      const missingColumn = match[1];
      if (!(missingColumn in updatePayload)) break;
      delete updatePayload[missingColumn];
    }

    if (updateResult?.error) {
      return errorResponse("Internal server error", 500, {
        context: { route: ROUTE, ...context },
      });
    }

    if (!updateResult?.data) {
      return errorResponse("Internal server error", 500, {
        context: { route: ROUTE, ...context },
      });
    }

    if (proposalResult.shareCreatedByUserId) {
      await logAuditEvent({
        supabase,
        companyId: proposalResult.companyId,
        actorUserId: proposalResult.shareCreatedByUserId,
        eventType: "proposal.approved",
        entityType: "bid",
        entityId: proposalResult.bidId,
        metadata: {
          token: parsedParams.data.token,
          approval_source: "public_proposal_token",
        },
      });
    }

    await enqueueOutboxEvent(supabase, {
      companyId: proposalResult.companyId,
      eventType: "bid.approved",
      aggregateType: "bid",
      aggregateId: proposalResult.bidId,
      idempotencyKey: `bid.approved:${proposalResult.bidId}`,
      payload: {
        bid_id: proposalResult.bidId,
        token: parsedParams.data.token,
      },
    });

    const refreshed = await getPublicProposalByToken(parsedParams.data.token);
    if (!refreshed.ok) {
      return errorResponse(refreshed.error, refreshed.status);
    }

    return Response.json({ item: refreshed.item });
  } catch {
    return errorResponse("Internal server error", 500, {
      context: { route: ROUTE, ...context },
    });
  }
}
