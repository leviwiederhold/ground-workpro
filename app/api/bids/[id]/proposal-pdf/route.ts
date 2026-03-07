/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/requireRole";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getBidSummaryData } from "@/lib/bids/getBidSummaryData";
import { calcBid } from "@/lib/pricing/calcBid";

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

const formatCurrency = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(parsed) ? parsed : 0);
};

const formatNumber = (value: unknown) => {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return "0";
  return String(Math.round(parsed * 100) / 100);
};

const formatDate = (value: unknown) => {
  if (!value) return "-";
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
};

const escapePdfText = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");

const buildLineItemLabel = (item: any) => {
  const description = String(item?.description ?? "").trim();
  const itemType = String(item?.item_type ?? "").trim();
  if (description) return description;
  if (itemType) return itemType;
  return `Line Item ${item?.id ?? ""}`.trim();
};

const buildPdf = (payload: {
  companyName: string;
  bid: any;
  summary: any;
  items: any[];
}) => {
  const rows: string[] = [];
  const push = (text: string, bold = false, size = 12) => {
    rows.push(`${bold ? "/F2" : "/F1"} ${size} Tf`);
    rows.push(`(${escapePdfText(text)}) Tj`);
    rows.push("0 -16 Td");
  };

  rows.push("BT");
  rows.push("50 790 Td");
  push("GROUNDWORK PRO", true, 18);
  push("PROPOSAL", true, 18);
  rows.push("0 -8 Td");

  push(`Company: ${payload.companyName || "-"}`);
  push(`Project: ${payload.bid?.project_name ?? payload.bid?.title ?? "-"}`);
  push(`Client: ${payload.bid?.client ?? "-"}`);
  push(`Bid Date: ${formatDate(payload.bid?.bid_date)}`);
  push(`Status: ${String(payload.bid?.status ?? "draft").toUpperCase()}`);

  rows.push("0 -8 Td");
  push("COST BREAKDOWN", true, 13);
  push(`Itemized Cost: ${formatCurrency(payload.summary?.itemizedCost)}`);
  push(`Equipment Hourly Cost: ${formatCurrency(payload.summary?.equipmentHourlyCost)}`);
  push(`Hauling Cost: ${formatCurrency(payload.summary?.haulingCost)}`);
  push(`Dump Cost: ${formatCurrency(payload.summary?.dumpCost)}`);
  push(`Fuel Cost: ${formatCurrency(payload.summary?.fuelCost)}`);
  push(`Contingency: ${formatCurrency(payload.summary?.contingencyCost)}`);
  push(`Subtotal Cost: ${formatCurrency(payload.summary?.subtotalCost)}`, true);
  push(`Revenue: ${formatCurrency(payload.summary?.revenue)}`, true);
  push(`Profit: ${formatCurrency(payload.summary?.profit)}`, true);
  push(`Margin: ${formatNumber(payload.summary?.marginPercent)}%`, true);

  rows.push("0 -8 Td");
  push("LINE ITEMS", true, 13);
  const lineItems = payload.items.slice(0, 18);
  for (const item of lineItems) {
    const quantity = Number(item?.quantity ?? 0);
    const unitCost = Number(item?.unit_cost ?? 0);
    const explicitTotal = Number(item?.total_cost);
    const total = Number.isFinite(explicitTotal) ? explicitTotal : quantity * unitCost;
    push(`- ${buildLineItemLabel(item)} | Qty ${formatNumber(quantity)} | Unit ${formatCurrency(unitCost)} | Total ${formatCurrency(total)}`);
  }

  rows.push("0 -8 Td");
  push("SIGNATURE", true, 13);
  push("Client Signature: ________________________________");
  push("Date: ________________________________");
  rows.push("ET");

  const stream = rows.join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "utf8");
};

export async function GET(
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

    const { supabase, companyId } = await getCompanyId();
    let summaryResult = await getBidSummaryData(supabase, companyId, parsedParams.data.id);
    if ("error" in summaryResult) {
      const { data: bidRow, error: bidError } = await supabase
        .from("bids")
        .select("*")
        .eq("company_id", companyId)
        .eq("id", parsedParams.data.id)
        .maybeSingle();
      if (bidError) {
        return NextResponse.json({ error: bidError.message }, { status: 400 });
      }
      if (!bidRow) {
        return NextResponse.json({ error: "Bid not found" }, { status: 404 });
      }

      let bidItemsResult = await supabase
        .from("bid_items")
        .select("*")
        .eq("company_id", companyId)
        .eq("bid_id", parsedParams.data.id);
      if (bidItemsResult.error?.message?.toLowerCase().includes("bid_id")) {
        bidItemsResult = await supabase
          .from("bid_items")
          .select("*")
          .eq("company_id", companyId)
          .eq("bidId", parsedParams.data.id);
      }
      const items = bidItemsResult.error ? [] : (bidItemsResult.data ?? []);
      summaryResult = {
        bid: bidRow,
        items,
        summary: calcBid(null, items),
      };
    }

    const { data: companyRow } = await supabase
      .from("companies")
      .select("name")
      .eq("id", companyId)
      .maybeSingle();

    const pdfBuffer = buildPdf({
      companyName: String(companyRow?.name ?? "Groundwork Pro"),
      bid: summaryResult.bid,
      summary: summaryResult.summary,
      items: summaryResult.items,
    });

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename=\"proposal-${parsedParams.data.id}.pdf\"`,
        "Cache-Control": "no-store",
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
