/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { requireRole } from "@/lib/auth/requireRole";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getBidSummaryData } from "@/lib/bids/getBidSummaryData";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const querySchema = z.object({
  format: z.enum(["json", "pdf"]).default("json"),
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
  value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

const buildPdf = (payload: {
  companyName: string;
  bid: any;
  summary: any;
  assumptions: any[];
  exclusions: any[];
  alternates: any[];
  risks: any[];
}) => {
  const rows: string[] = [];
  const push = (text: string, bold = false, size = 11) => {
    rows.push(`${bold ? "/F2" : "/F1"} ${size} Tf`);
    rows.push(`(${escapePdfText(text)}) Tj`);
    rows.push("0 -15 Td");
  };

  rows.push("BT");
  rows.push("40 790 Td");
  push("Precon Handoff Package", true, 16);
  push(`Company: ${payload.companyName || "-"}`);
  push(`Bid: ${payload.bid?.title ?? payload.bid?.project_name ?? "-"}`);
  push(`Client: ${payload.bid?.client ?? "-"}`);
  push(`Date: ${formatDate(new Date().toISOString())}`);
  rows.push("0 -5 Td");
  push("Financial Summary", true, 12);
  push(`Revenue: ${formatCurrency(payload.summary?.revenue)}`);
  push(`Total Cost: ${formatCurrency(payload.summary?.totalCost)}`);
  push(`Margin: ${Number(payload.summary?.marginPercent ?? 0).toFixed(2)}%`);
  rows.push("0 -5 Td");
  push(`Assumptions (${payload.assumptions.length})`, true, 12);
  payload.assumptions.slice(0, 6).forEach((line) => push(`- ${String(line.description ?? "")}`));
  push(`Exclusions (${payload.exclusions.length})`, true, 12);
  payload.exclusions.slice(0, 6).forEach((line) => push(`- ${String(line.description ?? "")}`));
  push(`Alternates (${payload.alternates.length})`, true, 12);
  payload.alternates.slice(0, 6).forEach((line) => push(`- ${String(line.description ?? "")}`));
  push(`Risk Register (${payload.risks.length})`, true, 12);
  payload.risks.slice(0, 8).forEach((risk) =>
    push(
      `- ${String(risk.title ?? "")} | ${String(risk.severity ?? "medium")} | ${formatCurrency(
        risk.cost_impact
      )}`
    )
  );
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
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    try {
      await requireRole(["admin", "pm", "foreman"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsedParams = paramsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json(toValidationError(parsedParams.error), { status: 422 });
    }

    const url = new URL(request.url);
    const parsedQuery = querySchema.safeParse({
      format: url.searchParams.get("format") ?? "json",
    });
    if (!parsedQuery.success) {
      return NextResponse.json(toValidationError(parsedQuery.error), { status: 422 });
    }

    const { supabase, companyId } = await getCompanyId();
    const summaryResult = await getBidSummaryData(supabase, companyId, parsedParams.data.id);
    if ("error" in summaryResult) {
      return NextResponse.json({ error: summaryResult.error }, { status: summaryResult.status });
    }

    const { data: latestVersion } = await supabase
      .from("bid_estimate_versions")
      .select("id, version_no, name, status")
      .eq("company_id", companyId)
      .eq("bid_id", parsedParams.data.id)
      .order("version_no", { ascending: false })
      .limit(1)
      .maybeSingle();

    let assumptions: any[] = [];
    let exclusions: any[] = [];
    let alternates: any[] = [];
    let risks: any[] = [];

    if (latestVersion?.id) {
      const [linesRes, risksRes] = await Promise.all([
        supabase
          .from("bid_estimate_version_lines")
          .select("id, line_type, description, amount")
          .eq("company_id", companyId)
          .eq("version_id", latestVersion.id),
        supabase
          .from("bid_estimate_risks")
          .select("id, title, severity, status, cost_impact")
          .eq("company_id", companyId)
          .eq("version_id", latestVersion.id),
      ]);
      if (!linesRes.error) {
        assumptions = (linesRes.data ?? []).filter((line: any) => line.line_type === "assumption");
        exclusions = (linesRes.data ?? []).filter((line: any) => line.line_type === "exclusion");
        alternates = (linesRes.data ?? []).filter((line: any) => line.line_type === "alternate");
      }
      if (!risksRes.error) {
        risks = risksRes.data ?? [];
      }
    }

    const packageItem = {
      bid: {
        id: summaryResult.bid.id,
        title: summaryResult.bid.title ?? summaryResult.bid.project_name ?? "",
        client: summaryResult.bid.client ?? "",
        status: summaryResult.bid.status ?? "draft",
      },
      summary: summaryResult.summary,
      estimateVersion: latestVersion
        ? {
            id: latestVersion.id,
            version_no: latestVersion.version_no,
            name: latestVersion.name,
            status: latestVersion.status,
          }
        : null,
      assumptions,
      exclusions,
      alternates,
      risk_register: {
        items: risks,
        total_cost_impact: (risks ?? []).reduce(
          (sum: number, row: any) => sum + Number(row.cost_impact ?? 0),
          0
        ),
      },
    };

    if (parsedQuery.data.format === "pdf") {
      const { data: companyRow } = await supabase
        .from("companies")
        .select("name")
        .eq("id", companyId)
        .maybeSingle();
      const pdf = buildPdf({
        companyName: String(companyRow?.name ?? "Groundwork Pro"),
        bid: packageItem.bid,
        summary: packageItem.summary,
        assumptions,
        exclusions,
        alternates,
        risks,
      });
      return new Response(pdf, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="handoff-${parsedParams.data.id}.pdf"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json({ item: packageItem });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
