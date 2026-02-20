/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { requireRole } from "@/lib/auth/requireRole";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { generateShareToken } from "@/lib/tokens";
import { requireActiveSubscription } from "@/lib/billing/requireActiveSubscription";
import { logAuditEvent } from "@/lib/audit/logAuditEvent";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

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
  try {
    const rawParams = await params;
    const parsedParams = paramsSchema.safeParse(rawParams);
    if (!parsedParams.success) {
      return NextResponse.json(toValidationError(parsedParams.error), { status: 422 });
    }

    const { supabase, companyId, userId } = await getCompanyId();
    try {
      await requireRole(["admin", "pm"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    if (!bid) {
      return NextResponse.json({ error: "Bid not found" }, { status: 404 });
    }

    if (!allowedStatuses.has(String(bid.status || "").toLowerCase())) {
      return NextResponse.json({ error: "Bid must be sent before sharing" }, { status: 409 });
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
        return NextResponse.json(
          { error: "Internal server error", details: insertResult.error?.message ?? null },
          { status: 500 }
        );
      }
    }

    if (!inserted) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
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
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
