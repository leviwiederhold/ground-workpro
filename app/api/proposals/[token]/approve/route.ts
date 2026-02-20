/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getPublicProposalByToken } from "@/lib/proposals/publicProposal";

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
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const rawParams = await params;
    const parsedParams = paramsSchema.safeParse(rawParams);
    if (!parsedParams.success) {
      return NextResponse.json(toValidationError(parsedParams.error), { status: 422 });
    }

    const proposalResult = await getPublicProposalByToken(parsedParams.data.token);
    if (!proposalResult.ok) {
      return NextResponse.json({ error: proposalResult.error }, { status: proposalResult.status });
    }

    const status = String(proposalResult.status || "").toLowerCase();
    if (status === "accepted") {
      return NextResponse.json({ error: "Proposal already accepted" }, { status: 409 });
    }
    if (status !== "sent") {
      return NextResponse.json({ error: "Bid must be sent before approval" }, { status: 409 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
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
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    if (!updateResult?.data) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const refreshed = await getPublicProposalByToken(parsedParams.data.token);
    if (!refreshed.ok) {
      return NextResponse.json({ error: refreshed.error }, { status: refreshed.status });
    }

    return NextResponse.json({ item: refreshed.item });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
