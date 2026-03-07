/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getEffectiveRole } from "@/lib/auth/effectiveRole";
import { getJobCostSummary } from "@/lib/job-costing/getJobCostSummary";
import { getBidSummaryData } from "@/lib/bids/getBidSummaryData";
import { getRoleScopedJobIds } from "@/lib/jobs/roleScope";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const normalizeRouteId = (id: string) => (/^\d+$/.test(id) ? Number(id) : id);
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const toNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const isoDate = (value: unknown) => {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const isoDateTime = (value: unknown) => {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const isMissingSchemaError = (errorMessage: string) => {
  const message = errorMessage.toLowerCase();
  return (
    message.includes("could not find the") ||
    (message.includes("column") && message.includes("does not exist")) ||
    (message.includes("relation") && message.includes("does not exist"))
  );
};

async function findAcceptedBid(supabase: any, companyId: string, jobId: string | number) {
  const attempts = [
    () =>
      supabase
        .from("bids")
        .select("id")
        .eq("company_id", companyId)
        .eq("job_id", jobId)
        .eq("status", "accepted")
        .order("created_at", { ascending: false })
        .limit(1),
    () =>
      supabase
        .from("bids")
        .select("id")
        .eq("company_id", companyId)
        .eq("jobId", jobId)
        .eq("status", "accepted")
        .order("created_at", { ascending: false })
        .limit(1),
    () =>
      supabase
        .from("bids")
        .select("id")
        .eq("company_id", companyId)
        .eq("job_id", jobId)
        .eq("status", "accepted")
        .order("id", { ascending: false })
        .limit(1),
    () =>
      supabase
        .from("bids")
        .select("id")
        .eq("company_id", companyId)
        .eq("jobId", jobId)
        .eq("status", "accepted")
        .order("id", { ascending: false })
        .limit(1),
  ];

  for (const run of attempts) {
    const result = await run();
    if (!result.error) {
      return result.data?.[0]?.id ?? null;
    }
    if (isMissingSchemaError(result.error.message || "")) continue;
    throw new Error(result.error.message || "Failed to load accepted bid");
  }

  return null;
}

function getCurrentWeekWindow() {
  const now = new Date();
  const utcNow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = utcNow.getUTCDay();
  const offsetToMonday = day === 0 ? -6 : 1 - day;
  const start = new Date(utcNow);
  start.setUTCDate(utcNow.getUTCDate() + offsetToMonday);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const parsed = paramsSchema.safeParse(await params);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation error" }, { status: 422 });
    }

    const jobId = normalizeRouteId(parsed.data.id);
    const { supabase, companyId, userId } = await getCompanyId();
    const role = await getEffectiveRole();
    if (!role) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const scopedJobIds = await getRoleScopedJobIds(supabase, companyId, userId, role);
    if (scopedJobIds && !scopedJobIds.includes(String(jobId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const jobResult = await supabase
      .from("jobs")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", jobId)
      .maybeSingle();

    if (jobResult.error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    if (!jobResult.data) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const job = jobResult.data as Record<string, unknown>;

    const week = getCurrentWeekWindow();

    const [assignmentRowsResult, dailyReportsResult, safetyLogsResult, safetyLogs7dResult, attachmentsResult] = await Promise.all([
      supabase
        .from("schedule_assignments")
        .select("id, date, employee_id, equipment_id")
        .eq("company_id", companyId)
        .eq("job_id", jobId)
        .gte("date", week.start)
        .lte("date", week.end)
        .order("date", { ascending: true })
        .limit(20),
      supabase
        .from("daily_reports")
        .select("id, date, work_accomplished, notes", { count: "exact" })
        .eq("company_id", companyId)
        .eq("job_id", jobId)
        .order("date", { ascending: false })
        .limit(5),
      supabase
        .from("safety_logs")
        .select("id, occurred_on, severity", { count: "exact" })
        .eq("company_id", companyId)
        .eq("job_id", jobId)
        .order("occurred_on", { ascending: false })
        .limit(5),
      supabase
        .from("safety_logs")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("job_id", jobId)
        .gte("occurred_on", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)),
      supabase
        .from("attachments")
        .select("id, file_name", { count: "exact" })
        .eq("company_id", companyId)
        .eq("entity_type", "job")
        .eq("entity_id", String(jobId))
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    const assignmentsError = assignmentRowsResult.error;
    const reportsError = dailyReportsResult.error;
    const safetyError = safetyLogsResult.error;
    const attachmentsError = attachmentsResult.error;

    const assignmentsRows = assignmentsError ? [] : (assignmentRowsResult.data ?? []);
    const reportRows = reportsError ? [] : (dailyReportsResult.data ?? []);
    const safetyRows = safetyError ? [] : (safetyLogsResult.data ?? []);
    const attachmentRows = attachmentsError ? [] : (attachmentsResult.data ?? []);

    const employeeIds = Array.from(new Set(assignmentsRows.map((row: any) => row.employee_id).filter(Boolean).map(String)));
    const equipmentIds = Array.from(new Set(assignmentsRows.map((row: any) => row.equipment_id).filter(Boolean).map(String)));

    const [employeesResult, equipmentResult] = await Promise.all([
      employeeIds.length
        ? supabase.from("employees").select("id, name").eq("company_id", companyId).in("id", employeeIds)
        : Promise.resolve({ data: [], error: null }),
      equipmentIds.length
        ? supabase.from("equipment").select("id, name").eq("company_id", companyId).in("id", equipmentIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const employeeNameById = new Map<string, string>();
    for (const row of (employeesResult.data ?? []) as Array<{ id: string; name: string | null }>) {
      employeeNameById.set(String(row.id), String(row.name ?? ""));
    }

    const equipmentNameById = new Map<string, string>();
    for (const row of (equipmentResult.data ?? []) as Array<{ id: string; name: string | null }>) {
      equipmentNameById.set(String(row.id), String(row.name ?? ""));
    }

    const assignments = assignmentsRows.map((row: any) => ({
      date: String(row.date ?? ""),
      employeeName: row.employee_id ? employeeNameById.get(String(row.employee_id)) ?? null : null,
      equipmentName: row.equipment_id ? equipmentNameById.get(String(row.equipment_id)) ?? null : null,
    }));

    const crewAssignedCount = new Set(assignmentsRows.map((row: any) => row.employee_id).filter(Boolean).map(String)).size;
    const equipmentAssignedCount = new Set(assignmentsRows.map((row: any) => row.equipment_id).filter(Boolean).map(String)).size;

    const dailyReportsItems = reportRows.map((row: any) => ({
      id: String(row.id),
      date: isoDate(row.date) ?? "",
      href: `/daily-reports/${row.id}`,
      summary: String(row.work_accomplished ?? row.notes ?? "") || null,
    }));

    const safetyItems = safetyRows.map((row: any) => ({
      id: String(row.id),
      date: isoDate(row.occurred_on) ?? "",
      type: String(row.severity ?? "log"),
      href: `/safety/${row.id}`,
    }));

    const documentsItems = attachmentRows.map((row: any) => ({
      id: String(row.id),
      filename: String(row.file_name ?? "attachment"),
      href: `/documents/${row.id}`,
    }));

    const financialVisible = role === "admin" || role === "pm";

    let acceptedBidValue = 0;
    let acceptedBidId: string | null = null;
    const contractValue = toNumber(job.contract_value ?? job.contractValue ?? job.budget);
    const approvedChangeOrdersValue = 0;
    let revenueTotal = 0;
    let costToDate = 0;
    let profit = 0;
    let marginPct = 0;

    if (financialVisible) {
      const acceptedId = await findAcceptedBid(supabase, companyId, jobId);
      if (acceptedId !== null && acceptedId !== undefined) {
        const bidSummary = await getBidSummaryData(supabase, companyId, acceptedId);
        if (!("error" in bidSummary)) {
          acceptedBidValue = round2(toNumber(bidSummary.summary?.revenue));
          acceptedBidId = String(acceptedId);
        }
      }

      const costSummary = await getJobCostSummary(supabase, companyId, jobId);
      if (costSummary.ok) {
        costToDate = round2(toNumber(costSummary.summary.actualTotalCost));
      }

      revenueTotal = acceptedBidValue > 0 ? acceptedBidValue : contractValue;
      profit = round2(revenueTotal - costToDate);
      marginPct = revenueTotal > 0 ? round2((profit / revenueTotal) * 100) : 0;
    }

    let targetMarginPct = 0;
    const pricingResult = await supabase
      .from("pricing_settings")
      .select("target_margin_percent")
      .eq("company_id", companyId)
      .maybeSingle();
    if (!pricingResult.error && pricingResult.data) {
      targetMarginPct = toNumber((pricingResult.data as Record<string, unknown>).target_margin_percent);
    }

    let hasUnreadMarginDriftAlert = false;
    const marginAlertResult = await supabase
      .from("alerts")
      .select("id")
      .eq("company_id", companyId)
      .eq("alert_type", "margin_drift")
      .eq("entity_type", "job")
      .eq("entity_id", String(jobId))
      .is("is_read", false)
      .limit(1);
    if (!marginAlertResult.error) {
      hasUnreadMarginDriftAlert = (marginAlertResult.data ?? []).length > 0;
    }

    const statusRaw = String(job.status ?? "").toLowerCase();
    const isActiveStatus = statusRaw === "active" || statusRaw === "in_progress";

    const riskReasons: string[] = [];
    let risk: "green" | "yellow" | "red" = "green";

    if (
      (isActiveStatus && financialVisible && targetMarginPct > 0 && marginPct < targetMarginPct) ||
      hasUnreadMarginDriftAlert
    ) {
      risk = "red";
      if (isActiveStatus && financialVisible && targetMarginPct > 0 && marginPct < targetMarginPct) {
        riskReasons.push("Margin is below target.");
      }
      if (hasUnreadMarginDriftAlert) {
        riskReasons.push("Unread margin drift alerts present.");
      }
    } else if (
      (isActiveStatus && financialVisible && revenueTotal > 0 && costToDate > revenueTotal * 0.8) ||
      (toNumber(safetyLogs7dResult.count ?? 0) > 0)
    ) {
      risk = "yellow";
      if (isActiveStatus && financialVisible && revenueTotal > 0 && costToDate > revenueTotal * 0.8) {
        riskReasons.push("Costs are above 80% of revenue.");
      }
      if (toNumber(safetyLogs7dResult.count ?? 0) > 0) {
        riskReasons.push("Safety logs recorded in the last 7 days.");
      }
    }

    const financial = financialVisible
      ? {
          visible: true,
          contractValue: round2(contractValue),
          acceptedBidValue: round2(acceptedBidValue),
          approvedChangeOrdersValue: round2(approvedChangeOrdersValue),
          revenueTotal: round2(revenueTotal),
          costToDate: round2(costToDate),
          profit: round2(profit),
          marginPct: round2(marginPct),
        }
      : {
          visible: false,
          contractValue: 0,
          acceptedBidValue: 0,
          approvedChangeOrdersValue: 0,
          revenueTotal: 0,
          costToDate: 0,
          profit: 0,
          marginPct: 0,
        };

    const item = {
      job: {
        id: String(job.id),
        name: String(job.name ?? ""),
        status: String(job.status ?? "draft"),
        clientName: (job.client_name ?? job.client ?? null) as string | null,
        siteAddress: (job.site_address ?? job.address ?? null) as string | null,
        startDate: isoDate(job.start_date ?? job.startDate),
        targetEndDate: isoDate(job.end_date ?? job.endDate),
        pmName: null,
        lastActivityAt: isoDateTime(job.updated_at ?? job.created_at),
      },
      health: {
        risk,
        reasons: riskReasons,
      },
      ops: {
        thisWeek: {
          crewAssignedCount,
          equipmentAssignedCount,
          assignments: { items: assignments },
        },
        dailyReports: {
          items: dailyReportsItems,
          total: toNumber(dailyReportsResult.count ?? dailyReportsItems.length),
        },
        safety: {
          items: safetyItems,
          total7d: toNumber(safetyLogs7dResult.count ?? 0),
        },
        documents: {
          items: documentsItems,
          total: toNumber(attachmentsResult.count ?? documentsItems.length),
        },
      },
      financial,
      acceptedBidId,
    };

    return NextResponse.json({ item });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      const status = error.status === 404 ? 404 : error.status === 403 ? 403 : 500;
      const message = status === 500 ? "Internal server error" : error.message;
      return NextResponse.json({ error: message }, { status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
