/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";

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

const getOrigin = (request: Request) => {
  const host = request.headers.get("x-forwarded-host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${host}`;
  }
  return request.headers.get("origin") ?? "";
};

async function loadLatestActiveShareLink(supabase: any, companyId: string, bidId: string) {
  const nowIso = new Date().toISOString();
  return supabase
    .from("bid_share_links")
    .select("token, expires_at, revoked_at, created_at")
    .eq("company_id", companyId)
    .eq("bid_id", bidId)
    .is("revoked_at", null)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
}

export async function GET(
  request: Request,
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

    const { supabase, companyId } = await getCompanyId();
    const origin = getOrigin(request);
    const bidId = parsedParams.data.id;

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
      return NextResponse.json({ item: null });
    }

    return NextResponse.json({
      item: {
        token: shareLink.token,
        url: `${origin}/proposal/${shareLink.token}`,
        expires_at: shareLink.expires_at ?? null,
        revoked_at: shareLink.revoked_at ?? null,
        created_at: shareLink.created_at ?? null,
      },
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
