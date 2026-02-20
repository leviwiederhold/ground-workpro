/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const toNumber = (value: unknown, fallback = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

export type PublicProposalItem = {
  proposal: {
    bid_id: string;
    status: string;
    sent_at: string | null;
    accepted_at: string | null;
    project_name: string;
    client_name: string | null;
  };
  items: Array<{
    id: string;
    name: string;
    description: string | null;
    quantity: number;
    unit: string | null;
    unit_price: number;
    total: number;
  }>;
  summary: {
    subtotal: number;
    total: number;
  };
  company: {
    name: string;
  };
};

export type PublicProposalResult =
  | { ok: true; item: PublicProposalItem; bidId: string; companyId: string; status: string }
  | { ok: false; status: number; error: string };

export async function getPublicProposalByToken(token: string): Promise<PublicProposalResult> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { ok: false, status: 500, error: "Internal server error" };
  }

  const { data: share, error: shareError } = await supabase
    .from("bid_share_links")
    .select("*")
    .eq("token", token)
    .maybeSingle();

  if (shareError) {
    return { ok: false, status: 500, error: "Internal server error" };
  }
  if (!share) {
    return { ok: false, status: 404, error: "Proposal not found" };
  }
  if (share.revoked_at) {
    return { ok: false, status: 404, error: "Proposal not found" };
  }
  if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) {
    return { ok: false, status: 404, error: "Proposal not found" };
  }

  const { data: bid, error: bidError } = await supabase
    .from("bids")
    .select("*")
    .eq("company_id", share.company_id)
    .eq("id", share.bid_id)
    .maybeSingle();

  if (bidError) {
    return { ok: false, status: 500, error: "Internal server error" };
  }
  if (!bid) {
    return { ok: false, status: 404, error: "Proposal not found" };
  }

  let itemsResult = await supabase
    .from("bid_items")
    .select("*")
    .eq("company_id", share.company_id)
    .eq("bid_id", share.bid_id)
    .order("created_at", { ascending: true });

  if (itemsResult.error?.message?.toLowerCase().includes("created_at")) {
    itemsResult = await supabase
      .from("bid_items")
      .select("*")
      .eq("company_id", share.company_id)
      .eq("bid_id", share.bid_id)
      .order("id", { ascending: true });
  }

  const { data: bidItems, error: itemsError } = itemsResult;
  if (itemsError) {
    return { ok: false, status: 500, error: "Internal server error" };
  }

  const mappedItems = (bidItems ?? []).map((item: any) => {
    const quantity = toNumber(item.quantity, 0);
    const unitPrice = toNumber(item.unit_price ?? item.unit_cost, 0);
    const total = toNumber(item.total ?? item.total_cost, quantity * unitPrice);
    return {
      id: item.id,
      name: item.name ?? item.description ?? "Line Item",
      description: item.description ?? null,
      quantity,
      unit: item.unit ?? null,
      unit_price: unitPrice,
      total,
    };
  });

  const subtotal = mappedItems.reduce((sum, item) => sum + toNumber(item.total, 0), 0);
  const total = subtotal;

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("*")
    .eq("id", share.company_id)
    .maybeSingle();

  if (companyError) {
    return { ok: false, status: 500, error: "Internal server error" };
  }

  return {
    ok: true,
    bidId: String(bid.id),
    companyId: String(share.company_id),
    status: String(bid.status ?? "draft"),
    item: {
      proposal: {
        bid_id: bid.id,
        status: bid.status ?? "draft",
        sent_at: bid.sent_at ?? null,
        accepted_at: bid.accepted_at ?? null,
        project_name: bid.project_name ?? bid.title ?? "",
        client_name: bid.client_name ?? bid.client ?? null,
      },
      items: mappedItems,
      summary: {
        subtotal,
        total,
      },
      company: {
        name: company?.name ?? company?.company_name ?? "",
      },
    },
  };
}
