/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/requireRole";

const paramsSchema = z.object({
  id: z.string().min(1),
});

const normalizeRouteId = (id: string) => (/^\d+$/.test(id) ? Number(id) : id);
const normalizeId = (id: unknown) => {
  if (id === null || id === undefined || id === "") return null;
  if (typeof id === "number") return id;
  if (typeof id === "string" && /^\d+$/.test(id)) return Number(id);
  return id;
};
const normalizeNumber = (value: unknown, fallback = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};
const VENDOR_STATUS_TAG_REGEX = /__gw_vendor_status:(preferred|on_hold|blocked)__/i;
const VENDOR_META_TAG_REGEX = /^__gw_vendor_meta:([^\n]+)__\n?/i;
const parseVendorMeta = (notes: unknown) => {
  const text = String(notes ?? "");
  const line = text.match(VENDOR_META_TAG_REGEX)?.[1];
  if (!line) return {};
  const params = new URLSearchParams(line);
  return {
    category: params.get("category") ?? "",
    payment_terms: params.get("payment_terms") ?? "",
    rating: params.get("rating"),
    active_orders: params.get("active_orders"),
  };
};
const stripSystemTags = (notes: unknown) =>
  String(notes ?? "")
    .replace(VENDOR_STATUS_TAG_REGEX, "")
    .replace(VENDOR_META_TAG_REGEX, "")
    .trimStart();
const getDisplayStatus = (row: any) => {
  const tagged = String(row.notes ?? "").match(VENDOR_STATUS_TAG_REGEX)?.[1];
  if (tagged) return tagged;
  return String(row.status ?? "active");
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    try {
      await requireRole(["admin", "pm", "foreman", "mechanic", "operator"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsedParams = paramsSchema.safeParse(await params);
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

    const vendorId = normalizeRouteId(parsedParams.data.id);
    const { supabase, companyId } = await getCompanyId();
    const supabaseAdmin = getSupabaseAdmin();

    const { data: vendorRow, error: vendorError } = await supabase
      .from("vendors")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", vendorId)
      .maybeSingle();

    if (vendorError) {
      return NextResponse.json({ error: vendorError.message }, { status: 400 });
    }
    if (!vendorRow) {
      return NextResponse.json({ error: "Vendor not found" }, { status: 404 });
    }

    let poResult = await supabase
      .from("purchase_orders")
      .select("id,status,created_at,purchase_order_items(quantity,unit_cost)", { count: "exact" })
      .eq("company_id", companyId)
      .eq("vendor_id", vendorId)
      .order("created_at", { ascending: false })
      .limit(25);

    if (poResult.error?.message?.toLowerCase().includes("created_at")) {
      poResult = await supabase
        .from("purchase_orders")
        .select("id,status,created_at,purchase_order_items(quantity,unit_cost)", { count: "exact" })
        .eq("company_id", companyId)
        .eq("vendor_id", vendorId)
        .order("id", { ascending: false })
        .limit(25);
    }

    if (poResult.error) {
      return NextResponse.json({ error: poResult.error.message }, { status: 400 });
    }

    const normalizedVendorId = String(normalizeId(vendorId));
    let attachmentsResult = await supabase
      .from("attachments")
      .select("*")
      .eq("company_id", companyId)
      .eq("entity_id", normalizeId(vendorId))
      .in("entity_type", ["vendor", "work_order"])
      .order("created_at", { ascending: false })
      .limit(50);

    if (attachmentsResult.error?.message?.toLowerCase().includes("created_at")) {
      attachmentsResult = await supabase
        .from("attachments")
        .select("*")
        .eq("company_id", companyId)
        .eq("entity_id", normalizeId(vendorId))
        .in("entity_type", ["vendor", "work_order"])
        .order("id", { ascending: false })
        .limit(50);
    }

    if (attachmentsResult.error) {
      return NextResponse.json({ error: attachmentsResult.error.message }, { status: 400 });
    }

    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(now.getDate() - 30);
    const thirtyDaysAgoISO = thirtyDaysAgo.toISOString();

    const purchaseOrders = poResult.data ?? [];
    const openStatuses = new Set(["draft", "submitted", "approved", "ordered"]);
    const openPOs = purchaseOrders
      .filter((po) => openStatuses.has(String(po.status || "").toLowerCase()))
      .slice(0, 5)
      .map((po) => ({
        id: po.id,
        status: po.status ?? "draft",
        href: `/purchase-orders/${po.id}`,
      }));

    const totalSpend30d = purchaseOrders.reduce((total, po: any) => {
      if (!po.created_at || po.created_at < thirtyDaysAgoISO) return total;
      const lineItems = Array.isArray(po.purchase_order_items) ? po.purchase_order_items : [];
      const poTotal = lineItems.reduce(
        (lineTotal: number, item: any) =>
          lineTotal + normalizeNumber(item.quantity, 0) * normalizeNumber(item.unit_cost, 0),
        0
      );
      return total + poTotal;
    }, 0);

    const attachmentRows = (attachmentsResult.data ?? []).filter((row: any) => {
      const entityType = String(row.entity_type ?? "");
      if (entityType === "vendor") return true;
      if (entityType !== "work_order") return false;
      const path = String(row.storage_path ?? row.path ?? row.file_path ?? "");
      return path.includes(`${companyId}/vendor/${normalizedVendorId}/`);
    });
    const storageClient = supabaseAdmin ?? supabase;
    const documents = await Promise.all(
      attachmentRows.map(async (row: any) => {
        const path = String(row.storage_path ?? row.path ?? row.file_path ?? "");
        const bucket = String(row.storage_bucket ?? row.bucket ?? "attachments");
        let href = null;
        if (path) {
          const signed = await storageClient.storage.from(bucket).createSignedUrl(path, 3600);
          href = signed.data?.signedUrl ?? null;
        }
        return {
          id: row.id,
          fileName: row.file_name ?? row.fileName ?? "",
          contentType: row.content_type ?? row.contentType ?? "",
          href,
        };
      })
    );

    const meta = parseVendorMeta(vendorRow.notes ?? "");
    const profile = {
      id: vendorRow.id,
      name: vendorRow.name ?? "",
      category: vendorRow.category ?? meta.category ?? "",
      status: getDisplayStatus(vendorRow),
      contact_name: vendorRow.contact_name ?? vendorRow.contact ?? "",
      phone: vendorRow.phone ?? "",
      email: vendorRow.email ?? "",
      address: vendorRow.address ?? "",
      payment_terms: vendorRow.payment_terms ?? vendorRow.paymentTerms ?? meta.payment_terms ?? "",
      notes: stripSystemTags(vendorRow.notes ?? ""),
    };

    const metrics = {
      open_po_count: openPOs.length,
      total_spend_30d: totalSpend30d,
      avg_delivery_days: 0,
    };

    return NextResponse.json({
      item: {
        profile,
        metrics,
        openPOs,
        documents,
      },
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Internal server error" }, { status: 500 });
  }
}
