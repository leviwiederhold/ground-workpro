import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getEffectiveRole } from "@/lib/auth/effectiveRole";
import type { AppRole } from "@/lib/nav/config";
import {
  ONBOARDING_DISMISSED_KEY,
  getOnboardingChecklistItemsForRole,
} from "@/lib/onboarding/checklist";
import { getDashboardWeather } from "@/lib/weather/dashboardWeather";

export const dynamic = "force-dynamic";

const querySchema = z.object({}).strict();

const ACTIVE_JOB_STATUSES = ["active", "open", "in_progress"];
const OPEN_WORK_ORDER_STATUSES = ["open", "scheduled", "in-progress", "in_progress"];

type DashboardResponse = {
  item: {
    role: AppRole;
    weather: {
      visible: true;
      locationLabel: string;
      tempF: number;
      condition: string;
      highF: number;
      lowF: number;
    };
    sections: {
      kpis: { items: Array<{ key: string; label: string; value: string; href?: string }> };
      primary: { items: Array<{ type: string; title: string; subtitle?: string; href?: string; meta?: Record<string, unknown> }> };
      alerts: { items: Array<{ type: string; message: string; href?: string; severity: "info" | "warn" | "danger" }> };
    };
  };
};

const asNumber = (value: unknown) => {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
};

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);

function isMissingTable(message: string, table: string) {
  const normalized = message.toLowerCase();
  return normalized.includes(table) && (normalized.includes("does not exist") || normalized.includes("not find"));
}

function isMissingColumn(message: string) {
  const normalized = String(message || "").toLowerCase();
  return normalized.includes("column") && (normalized.includes("does not exist") || normalized.includes("not find"));
}

function toError(error: unknown) {
  if (error instanceof TenantResolverError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Internal server error";
  return NextResponse.json({ error: message || "Internal server error" }, { status: 500 });
}

const normalizeEmail = (email: string | null | undefined) => String(email ?? "").trim().toLowerCase();

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsedQuery = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsedQuery.success) {
      return NextResponse.json({ error: "Validation error" }, { status: 422 });
    }

    const { supabase, companyId, userId } = await getCompanyId();
    const role = await getEffectiveRole();
    if (!role) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const now = new Date();
    const dateKey = now.toISOString().slice(0, 10);
    const weekEnd = new Date(now);
    weekEnd.setUTCDate(now.getUTCDate() + 7);
    const weekEndKey = weekEnd.toISOString().slice(0, 10);

    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(now.getDate() - 7);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    let activityQuery = supabase
      .from("notifications")
      .select("type, payload, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(5);
    if (role !== "admin" && role !== "pm") {
      activityQuery = activityQuery.eq("user_id", userId);
    }

    const [
      activeJobsResult,
      activeJobsCountResult,
      equipmentResult,
      employeesResult,
      employeesOnSiteCountResult,
      safetyCountResult,
      openWorkOrdersResult,
      openWorkOrdersCountResult,
      onboardingResult,
      inventoryResult,
      assignmentsTodayResult,
      assignmentsWeekResult,
      authUserResult,
      dailyReportTodayResult,
      recentActivityResult,
      monthBidsResult,
      allBidsCountResult,
      sentOrWonBidsCountResult,
      purchaseOrdersCountResult,
      companyResult,
    ] = await Promise.all([
      supabase
        .from("jobs")
        .select("*")
        .eq("company_id", companyId)
        .in("status", ACTIVE_JOB_STATUSES)
        .order("created_at", { ascending: false }),
      supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .in("status", ACTIVE_JOB_STATUSES),
      supabase.from("equipment").select("*").eq("company_id", companyId),
      supabase.from("employees").select("id, user_id, email, role").eq("company_id", companyId),
      supabase
        .from("employees")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("status", "clocked-in"),
      supabase
        .from("safety_logs")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .gte("occurred_on", sevenDaysAgo.toISOString().slice(0, 10)),
      supabase
        .from("work_orders")
        .select("id, title, status, assigned_to, equipment_id, priority")
        .eq("company_id", companyId)
        .in("status", OPEN_WORK_ORDER_STATUSES)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("work_orders")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .in("status", OPEN_WORK_ORDER_STATUSES),
      supabase
        .from("onboarding_checklist")
        .select("key, user_id, completed_at")
        .eq("company_id", companyId),
      supabase.from("inventory").select("id, quantity_on_hand, reorder_point").eq("company_id", companyId),
      supabase
        .from("schedule_assignments")
        .select("id, job_id, date, employee_id, equipment_id")
        .eq("company_id", companyId)
        .eq("date", dateKey)
        .order("created_at", { ascending: true }),
      supabase
        .from("schedule_assignments")
        .select("id, job_id, date, employee_id, equipment_id")
        .eq("company_id", companyId)
        .gte("date", dateKey)
        .lte("date", weekEndKey)
        .order("date", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase.auth.getUser(),
      supabase
        .from("daily_reports")
        .select("id, submitted_by")
        .eq("company_id", companyId)
        .eq("report_date", dateKey)
        .limit(200),
      activityQuery,
      supabase
        .from("bids")
        .select("status,revenue,total,bid_date,created_at")
        .eq("company_id", companyId)
        .in("status", ["accepted", "approved", "won"]),
      supabase
        .from("bids")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId),
      supabase
        .from("bids")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .in("status", ["sent", "accepted", "approved", "won"]),
      supabase
        .from("purchase_orders")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId),
      supabase
        .from("companies")
        .select("id,name,timezone,phone,email,address,website,industry,employee_count,default_work_hours,currency,date_format,company_logo")
        .eq("id", companyId)
        .maybeSingle(),
    ]);

    if (
      activeJobsResult.error &&
      !isMissingTable(activeJobsResult.error.message, "jobs") &&
      !isMissingColumn(activeJobsResult.error.message)
    ) {
      throw new Error(activeJobsResult.error.message);
    }
    if (
      activeJobsCountResult.error &&
      !isMissingTable(activeJobsCountResult.error.message, "jobs") &&
      !isMissingColumn(activeJobsCountResult.error.message)
    ) {
      throw new Error(activeJobsCountResult.error.message);
    }
    if (
      equipmentResult.error &&
      !isMissingTable(equipmentResult.error.message, "equipment") &&
      !isMissingColumn(equipmentResult.error.message)
    ) {
      throw new Error(equipmentResult.error.message);
    }
    if (
      openWorkOrdersResult.error &&
      !isMissingTable(openWorkOrdersResult.error.message, "work_orders") &&
      !isMissingColumn(openWorkOrdersResult.error.message)
    ) {
      throw new Error(openWorkOrdersResult.error.message);
    }
    if (
      openWorkOrdersCountResult.error &&
      !isMissingTable(openWorkOrdersCountResult.error.message, "work_orders") &&
      !isMissingColumn(openWorkOrdersCountResult.error.message)
    ) {
      throw new Error(openWorkOrdersCountResult.error.message);
    }
    if (
      companyResult.error &&
      !isMissingTable(companyResult.error.message, "companies") &&
      !isMissingColumn(companyResult.error.message)
    ) {
      throw new Error(companyResult.error.message);
    }

    const activeJobs = activeJobsResult.error ? [] : activeJobsResult.data ?? [];
    const activeJobsCount = activeJobsCountResult.error ? activeJobs.length : activeJobsCountResult.count ?? activeJobs.length;
    const equipmentRows = equipmentResult.error ? [] : equipmentResult.data ?? [];
    const employeeRows = employeesResult.error ? [] : employeesResult.data ?? [];
    const assignmentRowsToday = assignmentsTodayResult.error ? [] : assignmentsTodayResult.data ?? [];
    const assignmentRowsWeek = assignmentsWeekResult.error ? [] : assignmentsWeekResult.data ?? [];

    const authEmail = normalizeEmail(authUserResult.data?.user?.email);
    const userEmployeeIds = new Set<string>();
    for (const employee of employeeRows) {
      if (String(employee.user_id ?? "") === String(userId)) {
        userEmployeeIds.add(String(employee.id));
        continue;
      }
      if (authEmail && normalizeEmail(employee.email) === authEmail) {
        userEmployeeIds.add(String(employee.id));
      }
    }

    const equipmentById = new Map(equipmentRows.map((row) => [String(row.id), row]));
    const jobById = new Map(activeJobs.map((job) => [String(job.id), job]));

    const activeEquipmentCount = equipmentRows.filter((row) => String(row.status ?? "") === "active").length;
    const equipmentDownCount = equipmentRows.filter((row) => {
      const status = String(row.status ?? "").toLowerCase();
      return status === "maintenance" || status === "out_of_service" || status === "down";
    }).length;
    const maintenanceDueSoonCount = equipmentRows.filter((row) => {
      const hours = asNumber(row.hours ?? row.current_hours ?? row.meter_hours ?? 0);
      const nextService = asNumber(row.next_service ?? row.nextService ?? row.service_due_hours ?? 0);
      if (nextService <= 0) return false;
      return nextService - hours <= 150;
    }).length;
    const fleetUtilizationPct = equipmentRows.length > 0 ? Math.round((activeEquipmentCount / equipmentRows.length) * 100) : 0;

    const safetyCount = safetyCountResult.error ? 0 : safetyCountResult.count ?? 0;
    const employeesOnSite = employeesOnSiteCountResult.error ? 0 : employeesOnSiteCountResult.count ?? 0;
    const monthBids = monthBidsResult.error ? [] : monthBidsResult.data ?? [];
    const totalBidsCount = allBidsCountResult.error ? 0 : allBidsCountResult.count ?? 0;
    const sentOrWonBidsCount = sentOrWonBidsCountResult.error ? 0 : sentOrWonBidsCountResult.count ?? 0;
    const purchaseOrdersCount = purchaseOrdersCountResult.error ? 0 : purchaseOrdersCountResult.count ?? 0;
    const companyProfile = companyResult.error ? null : companyResult.data;
    const companySettingsCompleted = Boolean(
      String(companyProfile?.name ?? "").trim() &&
      String(companyProfile?.phone ?? "").trim() &&
      String(companyProfile?.email ?? "").trim() &&
      String(companyProfile?.address ?? "").trim() &&
      String(companyProfile?.currency ?? "").trim() &&
      String(companyProfile?.date_format ?? "").trim()
    );
    const companyTimezoneConfigured = Boolean(String(companyProfile?.timezone ?? "").trim());
    const companyLogoUploaded = Boolean(String(companyProfile?.company_logo ?? "").trim());
    const monthRevenue = monthBids.reduce((sum, bid) => {
      const rawDate = bid.bid_date ?? bid.created_at;
      if (!rawDate) return sum;
      const parsed = new Date(rawDate);
      if (Number.isNaN(parsed.getTime())) return sum;
      if (parsed < monthStart || parsed >= monthEnd) return sum;
      return sum + asNumber(bid.revenue ?? bid.total ?? 0);
    }, 0);

    const workOrderRows = openWorkOrdersResult.error ? [] : openWorkOrdersResult.data ?? [];
    const openWorkOrdersCount = openWorkOrdersCountResult.error ? workOrderRows.length : openWorkOrdersCountResult.count ?? workOrderRows.length;
    const workOrderTopFive = workOrderRows.slice(0, 5);

    const inventoryRows = inventoryResult.error ? [] : inventoryResult.data ?? [];
    const lowPartsCount = inventoryRows.filter((row) => {
      const qty = asNumber(row.quantity_on_hand);
      const reorder = asNumber(row.reorder_point);
      return reorder > 0 && qty <= reorder;
    }).length;

    const onboardingRows = onboardingResult.error ? [] : onboardingResult.data ?? [];
    const completedMap = new Map<string, { completed_at: string | null }>();
    for (const row of onboardingRows) {
      const key = `${String(row.key)}::${row.user_id ? String(row.user_id) : "__company__"}`;
      completedMap.set(key, { completed_at: row.completed_at });
    }
    const onboardingDismissed = Boolean(completedMap.get(`${ONBOARDING_DISMISSED_KEY}::${userId}`)?.completed_at);
    const roleChecklistItems = getOnboardingChecklistItemsForRole(role);
    const authUser = authUserResult.error ? null : authUserResult.data?.user ?? null;
    const profileNameCompleted = Boolean(
      String(
        authUser?.user_metadata?.full_name ??
          authUser?.user_metadata?.name ??
          ""
      ).trim()
    );
    const derivedChecklistCompleted: Record<string, boolean> = {
      complete_company_settings: companySettingsCompleted,
      upload_company_logo: companyLogoUploaded,
      set_company_timezone: companyTimezoneConfigured,
      invite_teammate: employeeRows.length > 1,
      configure_permissions: employeeRows.length > 1,
      connect_integrations: false,
      finish_profile: profileNameCompleted,
      create_first_job: activeJobsCount > 0,
      create_first_bid: totalBidsCount > 0,
      send_first_proposal: sentOrWonBidsCount > 0,
      add_first_equipment: equipmentRows.length > 0,
      create_first_po: purchaseOrdersCount > 0,
    };

    const checklistItems = roleChecklistItems.map((item) => {
      const persistedCompleted = Boolean(
        completedMap.get(`${item.key}::${item.scope === "company" ? "__company__" : userId}`)?.completed_at
      );
      return {
        key: item.key,
        label: item.label,
        description: item.description,
        view: item.view,
        scope: item.scope,
        completed: persistedCompleted || Boolean(derivedChecklistCompleted[item.key]),
      };
    });

    const kpis: DashboardResponse["item"]["sections"]["kpis"]["items"] = [];
    const primary: DashboardResponse["item"]["sections"]["primary"]["items"] = [];
    const alerts: DashboardResponse["item"]["sections"]["alerts"]["items"] = [];
    const weather = await getDashboardWeather();
    const recentActivityRows = recentActivityResult.error ? [] : recentActivityResult.data ?? [];
    const recentActivityAlerts = recentActivityRows.slice(0, 3).map((row, index) => {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      const summary =
        typeof payload.summary === "string"
          ? payload.summary
          : typeof payload.jobName === "string"
            ? payload.jobName
            : typeof payload.eventTitle === "string"
              ? payload.eventTitle
              : "";
      return {
        type: `activity_${index}`,
        message: summary ? `Recent: ${summary}` : `Recent: ${String(row.type ?? "Activity")}`,
        href: typeof payload.href === "string" ? payload.href : undefined,
        severity: "info" as const,
      };
    });

    if (role === "admin") {
      kpis.push(
        { key: "active_jobs", label: "Active Jobs", value: String(activeJobsCount), href: "/jobs" },
        { key: "fleet_utilization", label: "Fleet Utilization", value: `${fleetUtilizationPct}%`, href: "/fleet" },
        { key: "crew_on_site", label: "Crew On-Site", value: String(employeesOnSite), href: "/team" },
        { key: "month_revenue", label: "Month Revenue", value: formatCurrency(monthRevenue), href: "/finance" }
      );

      primary.push(
        {
          type: "active_jobs",
          title: "Active Jobs",
          href: "/jobs",
          meta: {
            items: activeJobs.slice(0, 5).map((job) => ({
              id: String(job.id),
              title: String(job.name ?? "Untitled Job"),
              href: `/jobs/${job.id}`,
              sublabel: String(job.client ?? ""),
            })),
          },
        },
        {
          type: "getting_started",
          title: "Getting Started",
          meta: {
            enabled: !onboardingDismissed,
            items: checklistItems,
            completedCount: checklistItems.filter((item) => item.completed).length,
            totalCount: checklistItems.length,
            dismissed: onboardingDismissed,
          },
        },
        {
          type: "quick_actions",
          title: "Quick Actions",
          meta: {
            items: [
              { key: "add_event", label: "Add Event", href: "calendar-event" },
              { key: "time_clock", label: "Time Clock", href: "time-clock" },
              { key: "check_in", label: "Check-In", href: "equipment-checkin" },
              { key: "daily_report", label: "Daily Report", href: "daily-report" },
              { key: "work_order", label: "Work Order", href: "work-order" },
              { key: "safety_sign_off", label: "Safety Sign-Off", href: "safety" },
            ],
          },
        },
        {
          type: "equipment_locations",
          title: "Equipment Locations - Cincinnati Area",
          meta: { enabled: true },
        },
        {
          type: "open_work_orders",
          title: "Open Work Orders",
          href: "/maintenance",
          meta: {
            items: workOrderTopFive.map((row) => ({
              id: String(row.id),
              title: String(row.title ?? "Work Order"),
              href: "/maintenance",
            })),
          },
        }
      );

      alerts.push(
        { type: "maintenance_due", message: `Maintenance Due Soon: ${maintenanceDueSoonCount}`, href: "/maintenance", severity: "warn" },
        { type: "safety_7d", message: `Safety Logs (7d): ${safetyCount}`, href: "/safety", severity: "info" }
      );
      alerts.push(...recentActivityAlerts);
    }

    if (role === "operator") {
      const myTodayAssignments = assignmentRowsToday.filter((row) => row.employee_id && userEmployeeIds.has(String(row.employee_id)));
      const myUpcomingAssignments = assignmentRowsWeek.filter((row) => row.employee_id && userEmployeeIds.has(String(row.employee_id))).slice(0, 3);
      const todayFirst = myTodayAssignments[0];
      const todayJob = todayFirst ? jobById.get(String(todayFirst.job_id)) : null;

      primary.push(
        {
          type: "getting_started",
          title: "Getting Started",
          meta: {
            enabled: !onboardingDismissed,
            items: checklistItems,
            completedCount: checklistItems.filter((item) => item.completed).length,
            totalCount: checklistItems.length,
            dismissed: onboardingDismissed,
          },
        },
        {
          type: "my_assignment_today",
          title: "My assignment today",
          subtitle: todayFirst
            ? `${String(todayJob?.name ?? "Job")}${todayJob?.address ? ` • ${String(todayJob.address)}` : ""}`
            : "No assignment yet",
          href: "/schedule",
          meta: {
            empty: !todayFirst,
            item: todayFirst
              ? {
                  jobName: String(todayJob?.name ?? "Job"),
                  address: String(todayJob?.address ?? ""),
                  startTime: "07:00",
                  endTime: "15:00",
                  equipment: todayFirst.equipment_id
                    ? String(equipmentById.get(String(todayFirst.equipment_id))?.name ?? "Assigned equipment")
                    : "",
                }
              : null,
          },
        },
        {
          type: "this_week",
          title: "This week",
          subtitle: "Next 3 upcoming assignments",
          href: "/schedule",
          meta: {
            items: myUpcomingAssignments.map((row) => {
              const job = jobById.get(String(row.job_id));
              return {
                id: String(row.id),
                label: `${String(job?.name ?? "Job")}`,
                sublabel: `${String(row.date)}${job?.address ? ` • ${String(job.address)}` : ""}`,
              };
            }),
          },
        }
      );

      alerts.push({ type: "operator_safety", message: `Safety items (7d): ${safetyCount}`, href: "/safety", severity: "info" });
      alerts.push(...recentActivityAlerts);
      kpis.push({ key: "my_jobs_today", label: "My Jobs Today", value: String(myTodayAssignments.length), href: "/schedule" });
    }

    if (role === "mechanic") {
      const myWorkOrders = workOrderRows
        .filter((row) => String(row.assigned_to ?? "") === String(userId))
        .slice(0, 5);
      const visibleWorkOrders = myWorkOrders.length > 0 ? myWorkOrders : workOrderTopFive;

      primary.push({
        type: "open_work_orders",
        title: "Open work orders assigned to me",
        subtitle: "Top 5",
        href: "/maintenance",
        meta: {
          items: visibleWorkOrders.map((row) => ({
            id: String(row.id),
            title: String(row.title ?? "Work Order"),
            priority: String(row.priority ?? "normal"),
            status: String(row.status ?? "open"),
            equipment: row.equipment_id ? String(equipmentById.get(String(row.equipment_id))?.name ?? "") : "",
          })),
        },
      });
      primary.push({
        type: "equipment_out_of_service",
        title: "Equipment out of service",
        subtitle: `${equipmentDownCount}`,
        href: "/fleet",
      });

      kpis.push(
        { key: "open_work_orders", label: "Open Work Orders", value: String(openWorkOrdersCount), href: "/maintenance" },
        { key: "equipment_down", label: "Equipment Down", value: String(equipmentDownCount), href: "/fleet" },
        { key: "parts_low", label: "Parts Low", value: String(lowPartsCount), href: "/inventory" }
      );
      alerts.push({ type: "maintenance_due", message: `Maintenance due soon: ${maintenanceDueSoonCount}`, href: "/maintenance", severity: "warn" });
      alerts.push(...recentActivityAlerts);
    }

    if (role === "foreman") {
      const myTodayAssignments = assignmentRowsToday.filter((row) => row.employee_id && userEmployeeIds.has(String(row.employee_id)));
      const myJobIds = new Set(myTodayAssignments.map((row) => String(row.job_id)));
      const crewCount = assignmentRowsToday.filter((row) => myJobIds.has(String(row.job_id)) && row.employee_id).length;
      const equipmentCount = assignmentRowsToday.filter((row) => myJobIds.has(String(row.job_id)) && row.equipment_id).length;
      const reportsToday = dailyReportTodayResult.error ? [] : dailyReportTodayResult.data ?? [];
      const submittedToday = reportsToday.some((row) => String(row.submitted_by ?? "") === String(userId));

      primary.push(
        {
          type: "today_jobs",
          title: "Today’s jobs I’m on",
          subtitle: `${myJobIds.size} jobs • ${crewCount} crew • ${equipmentCount} equipment`,
          href: "/schedule",
        },
        {
          type: "daily_report_status",
          title: "Daily report status",
          subtitle: submittedToday ? "Submitted today" : "Not submitted today",
          href: "/reports",
        },
        {
          type: "safety_reminders",
          title: "Safety reminders",
          subtitle: "Hydrate, inspect PPE, and review tailboard notes.",
          href: "/safety",
        }
      );

      kpis.push({ key: "my_active_jobs", label: "My Active Jobs", value: String(myJobIds.size), href: "/schedule" });
      alerts.push({ type: "safety_7d", message: `Safety logs (7d): ${safetyCount}`, href: "/safety", severity: "info" });
      alerts.push(...recentActivityAlerts);
    }

    if (role === "pm") {
      const assignedJobIdsToday = new Set(assignmentRowsToday.map((row) => String(row.job_id)));
      const unassignedJobsToday = activeJobs.filter((job) => !assignedJobIdsToday.has(String(job.id))).length;
      const peopleBooked = assignmentRowsToday.filter((row) => row.employee_id).length;
      const equipmentBooked = assignmentRowsToday.filter((row) => row.equipment_id).length;

      primary.push(
        {
          type: "staffing_gaps",
          title: "Staffing gaps",
          subtitle: `${unassignedJobsToday} unassigned jobs today`,
          href: "/schedule",
        },
        {
          type: "schedule_overview",
          title: "Today schedule overview",
          subtitle: `${peopleBooked} people booked • ${equipmentBooked} equipment booked`,
          href: "/schedule",
        },
        {
          type: "approvals_alerts",
          title: "Approvals/alerts",
          subtitle: `${safetyCount} safety open items`,
          href: "/safety",
        }
      );

      kpis.push(
        { key: "active_jobs", label: "Active Jobs", value: String(activeJobsCount), href: "/jobs" },
        { key: "fleet_utilization", label: "Fleet Utilization", value: `${fleetUtilizationPct}%`, href: "/fleet" },
        { key: "crew_on_site", label: "Crew On-Site", value: String(employeesOnSite), href: "/team" }
      );
      alerts.push({ type: "pm_alerts", message: `Maintenance Due Soon: ${maintenanceDueSoonCount}`, href: "/maintenance", severity: "warn" });
      alerts.push(...recentActivityAlerts);
    }

    const response: DashboardResponse = {
      item: {
        role,
        weather: {
          visible: true,
          locationLabel: weather.locationLabel,
          tempF: weather.tempF,
          condition: weather.condition,
          highF: weather.highF,
          lowF: weather.lowF,
        },
        sections: {
          kpis: { items: kpis },
          primary: { items: primary },
          alerts: { items: alerts },
        },
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    return toError(error);
  }
}
