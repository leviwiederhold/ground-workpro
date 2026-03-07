/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/requireRole";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { generateShareToken } from "@/lib/tokens";
import { requireActiveSubscription } from "@/lib/billing/requireActiveSubscription";
import { logAuditEvent } from "@/lib/audit/logAuditEvent";
import { errorResponse } from "@/lib/http/errorResponse";
import { enforceRateLimit } from "@/lib/http/rateLimit";

const paramsSchema = z.object({
  id: z.string().uuid(),
});
const ROUTE = "/api/bids/[id]/share";

const allowedStatuses = new Set(["sent"]);

const toValidationError = (error: any) => ({
  error: "Validation error",
  details: error.issues.map((issue: any) => ({
    path: issue.path.join("."),
    message: issue.message,
  })),
});

const getOrigin = (request: Request) => {
  const host = request.headers.get("x-forwarded-host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${host}`;
  }
  return request.headers.get("origin") ?? "";
};

async function insertShareLinkWithFallback(
  supabase: any,
  payload: {
    company_id: string;
    bid_id: string;
    token: string;
    created_by: string;
    expires_at: null;
  }
) {
  let result = await supabase
    .from("bid_share_links")
    .insert(payload)
    .select("token, expires_at")
    .maybeSingle();

  if (!result.error) return result;

  const message = (result.error.message || "").toLowerCase();
  const canRetryWithoutCreatedBy =
    message.includes("created_by") ||
    message.includes("foreign key") ||
    message.includes("violates foreign key constraint");

  if (!canRetryWithoutCreatedBy) return result;

  const fallbackPayload = {
    company_id: payload.company_id,
    bid_id: payload.bid_id,
    token: payload.token,
    expires_at: payload.expires_at,
  };

  result = await supabase
    .from("bid_share_links")
    .insert(fallbackPayload)
    .select("token, expires_at")
    .maybeSingle();

  return result;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let context: { companyId?: string; userId?: string; role?: string } = {};
  const rateLimited = enforceRateLimit(request, {
    keyPrefix: "bid-share-create",
    limit: 30,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  try {
    const rawParams = await params;
    const parsedParams = paramsSchema.safeParse(rawParams);
    if (!parsedParams.success) {
      return NextResponse.json(toValidationError(parsedParams.error), { status: 422 });
    }

    const { supabase, companyId, userId } = await getCompanyId();
    try {
      const access = await requireRole(["admin", "pm"]);
      context = { companyId: access.companyId, userId: access.userId, role: access.role };
    } catch {
      return errorResponse("Forbidden", 403);
    }

    const subscriptionError = await requireActiveSubscription(supabase, companyId);
    if (subscriptionError) {
      return subscriptionError;
    }

    // Ensure profile exists for created_by FK on bid_share_links.
    const { data: authData } = await supabase.auth.getUser();
    const profileName = authData?.user?.email ?? authData?.user?.id ?? userId;
    await supabase.from("profiles").upsert({ id: userId, full_name: profileName });
    await supabase.from("profiles").upsert({ id: userId, name: profileName });

    const { data: bid, error: bidError } = await supabase
      .from("bids")
      .select("id, company_id, status")
      .eq("company_id", companyId)
      .eq("id", parsedParams.data.id)
      .maybeSingle();

    if (bidError) {
      return errorResponse("Internal server error", 500, {
        context: { route: ROUTE, ...context },
      });
    }

    if (!bid) {
      return errorResponse("Bid not found", 404);
    }

    if (!allowedStatuses.has(String(bid.status || "").toLowerCase())) {
      return errorResponse("Bid must be sent before sharing", 409);
    }

    let inserted: any = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = generateShareToken(24);
      const insertResult = await insertShareLinkWithFallback(supabase, {
        company_id: companyId,
        bid_id: parsedParams.data.id,
        token,
        created_by: userId,
        expires_at: null,
      });

      if (!insertResult.error && insertResult.data) {
        inserted = insertResult.data;
        break;
      }

      const errorMessage = insertResult.error?.message?.toLowerCase() || "";
      const isCollision =
        insertResult.error?.code === "23505" ||
        errorMessage.includes("duplicate key") ||
        errorMessage.includes("bid_share_links_token_key");

      if (!isCollision) {
        return errorResponse("Internal server error", 500, {
          details: insertResult.error?.message ?? null,
          context: { route: ROUTE, ...context },
        });
      }
    }

    if (!inserted) {
      return errorResponse("Internal server error", 500, {
        context: { route: ROUTE, ...context },
      });
    }

    const origin = getOrigin(request);
    const shareUrl = `${origin}/proposal/${inserted.token}`;

    await logAuditEvent({
      supabase,
      companyId,
      actorUserId: userId,
      eventType: "bid.share.created",
      entityType: "bid",
      entityId: parsedParams.data.id,
      metadata: {
        token: inserted.token,
        url: shareUrl,
      },
    });

    return NextResponse.json({
      item: {
        token: inserted.token,
        url: shareUrl,
        expires_at: null,
      },
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      if (error.status === 401) {
        return errorResponse("Unauthorized", 401);
      }
      return errorResponse("Forbidden", 403);
    }
    return errorResponse("Internal server error", 500, {
      context: { route: ROUTE, ...context },
    });
  }
}
