import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import {
  ONBOARDING_DISMISSED_KEY,
  getOnboardingChecklistItemsForRole,
} from "@/lib/onboarding/checklist";
import { getEffectiveRole } from "@/lib/auth/effectiveRole";
import type { AppRole } from "@/lib/nav/config";
import { getStatsForRole } from "@/lib/stats/getStats";
import { getDashboardWeather } from "@/lib/weather/dashboardWeather";
import { listFallbackChecklistRows } from "@/lib/onboarding/fallbackStore";
import {
  applyPermissionOverrideFromCookie,
  resolveUserModulePermissions,
  TEST_MODULE_ACCESS_COOKIE,
} from "@/lib/permissions/runtime";
import {
  loadProfileForSetup,
  isAccountDerivedComplete,
  isCompanyDerivedComplete,
  isProfileDerivedComplete,
} from "@/lib/onboarding/setupFlow";

export const dynamic = "force-dynamic";

type Role = AppRole;

type DashboardSummary = {
  role: Role;
  kpis: Array<{
    key: string;
    label: string;
    value: number | string;
    sublabel?: string;
    trendPct?: number | null;
    href?: string | null;
    visible?: boolean;
  }>;
  sections: {
    activeJobs?: {
      items: Array<{ id: string; title: string; href: string; sublabel?: string }>;
      viewAllHref?: string;
    };
    gettingStarted?: {
      enabled: boolean;
      items: Array<{
        key: string;
        label: string;
        description: string;
        view: string;
        href: string;
        scope: "company" | "user";
        completed: boolean;
      }>;
      completedCount: number;
      totalCount: number;
      dismissed?: boolean;
    };
    quickActions?: {
      items: Array<{ key: string; label: string; href: string }>;
    };
    alerts?: {
      items: Array<{ key: string; label: string; value: number; href?: string }>;
    };
    weather?: {
      enabled: boolean;
      mode: "placeholder" | "live";
      locationLabel: string;
      item: { tempF: number; condition: string; note?: string };
    };
    equipmentLocations?: { enabled: boolean; mode: "placeholder" };
    openWorkOrders?: {
      items: Array<{ id: string; title: string; href: string }>;
      viewAllHref?: string;
    };
  };
};

const asNumber = (value: unknown) => {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
};

const ACTIVE_JOB_STATUSES = ["active", "open", "in_progress"];
const OPEN_WORK_ORDER_STATUSES = ["open", "scheduled", "in-progress", "in_progress"];
const isMissingOnboardingTable = (message: string | undefined) =>
  /onboarding_checklist/i.test(String(message || "")) && /does not exist|not find/i.test(String(message || ""));

function toError(error: unknown) {
  if (error instanceof TenantResolverError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Internal server error";
  return NextResponse.json({ error: message || "Internal server error" }, { status: 500 });
}

export async function GET() {
  try {
    const { supabase, companyId, userId } = await getCompanyId();
    const role = await getEffectiveRole();
    if (!role) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const cookieStore = await cookies();
    let modulePermissions = await resolveUserModulePermissions({
      supabase,
      companyId,
      userId,
      role,
    });
    if (process.env.NODE_ENV !== "production" || process.env.E2E === "true") {
      modulePermissions = applyPermissionOverrideFromCookie(
        modulePermissions,
        cookieStore.get(TEST_MODULE_ACCESS_COOKIE)?.value
      );
    }

    const activeJobsQuery = supabase
      .from("jobs")
      .select("*")
      .eq("company_id", companyId)
      .in("status", ACTIVE_JOB_STATUSES)
      .order("created_at", { ascending: false });

    const activeJobsCountQuery = supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .in("status", ACTIVE_JOB_STATUSES);

    const equipmentQuery = supabase
      .from("equipment")
      .select("*")
      .eq("company_id", companyId);

    const employeesOnSiteCountQuery = supabase
      .from("employees")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("status", "clocked-in");
    const employeesCountQuery = supabase
      .from("employees")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId);

    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(now.getDate() - 7);

    const safetyCountQuery = supabase
      .from("safety_logs")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .gte("occurred_on", sevenDaysAgo.toISOString().slice(0, 10));

    const openWorkOrdersQuery = supabase
      .from("work_orders")
      .select("id, title, status, assigned_to")
      .eq("company_id", companyId)
      .in("status", OPEN_WORK_ORDER_STATUSES)
      .order("created_at", { ascending: false })
      .limit(5);

    const openWorkOrdersCountQuery = supabase
      .from("work_orders")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .in("status", OPEN_WORK_ORDER_STATUSES);

    const onboardingQuery = supabase
      .from("onboarding_checklist")
      .select("key, user_id, completed_at")
      .eq("company_id", companyId);
    const companyQuery = supabase
      .from("companies")
      .select("id,name,timezone,phone,email,address,website,industry,employee_count,default_work_hours,currency,date_format,company_logo")
      .eq("id", companyId)
      .maybeSingle();

    const inventoryLowPartsCountQuery = supabase
      .from("inventory")
      .select("id, quantity_on_hand, reorder_point")
      .eq("company_id", companyId);

    const [
      activeJobsResult,
      activeJobsCountResult,
      equipmentResult,
      employeesOnSiteCountResult,
      safetyCountResult,
      openWorkOrdersResult,
      openWorkOrdersCountResult,
      onboardingResult,
      inventoryLowPartsResult,
      companyResult,
      employeesCountResult,
      profile,
      integrationsCountResult,
      totalBidsCountResult,
      sentBidsCountResult,
      purchaseOrdersCountResult,
      dailyReportsByUserCountResult,
      safetyLogsByUserCountResult,
    ] = await Promise.all([
      activeJobsQuery,
      activeJobsCountQuery,
      equipmentQuery,
      employeesOnSiteCountQuery,
      safetyCountQuery,
      openWorkOrdersQuery,
      openWorkOrdersCountQuery,
      onboardingQuery,
      inventoryLowPartsCountQuery,
      companyQuery,
      employeesCountQuery,
      loadProfileForSetup(supabase, userId),
      supabase.from("integration_connections").select("id", { count: "exact", head: true }).eq("company_id", companyId),
      supabase.from("bids").select("id", { count: "exact", head: true }).eq("company_id", companyId),
      supabase
        .from("bids")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .in("status", ["sent", "accepted", "approved", "won"]),
      supabase.from("purchase_orders").select("id", { count: "exact", head: true }).eq("company_id", companyId),
      supabase.from("daily_reports").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("submitted_by", userId),
      supabase.from("safety_logs").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("created_by", userId),
    ]);

    if (activeJobsResult.error) throw new Error(activeJobsResult.error.message);
    if (activeJobsCountResult.error) throw new Error(activeJobsCountResult.error.message);
    if (equipmentResult.error) throw new Error(equipmentResult.error.message);
    if (employeesOnSiteCountResult.error) throw new Error(employeesOnSiteCountResult.error.message);
    if (openWorkOrdersResult.error) throw new Error(openWorkOrdersResult.error.message);
    if (openWorkOrdersCountResult.error) throw new Error(openWorkOrdersCountResult.error.message);

    const activeJobsAll = (activeJobsResult.data ?? []).map((job) => ({
      id: String(job.id),
      title: String(job.name ?? "Untitled Job"),
      href: `/jobs/${job.id}`,
      sublabel: String(job.client ?? ""),
      createdBy: String(job.created_by ?? ""),
    }));

    let activeJobsItems = activeJobsAll.slice(0, 5);
    let activeJobsCount = activeJobsCountResult.count ?? activeJobsItems.length;

    if (role === "pm") {
      const createdByMine = activeJobsAll.filter((job) => job.createdBy === userId);
      if (createdByMine.length > 0) {
        activeJobsItems = createdByMine.slice(0, 5);
        activeJobsCount = createdByMine.length;
      }
    }

    if (role === "foreman" || role === "operator") {
      activeJobsItems = activeJobsAll.slice(0, 5);
      activeJobsCount = activeJobsAll.length;
    }

    const equipmentRows = equipmentResult.data ?? [];
    const activeEquipmentCount = equipmentRows.filter((row) => String(row.status ?? "") === "active").length;
    const equipmentDownCount = equipmentRows.filter((row) => String(row.status ?? "") === "maintenance").length;
    const maintenanceDueSoonCount = equipmentRows.filter((row) => {
      const hours = asNumber(row.hours ?? row.current_hours ?? row.meter_hours ?? 0);
      const nextService = asNumber(row.next_service ?? row.nextService ?? row.service_due_hours ?? 0);
      if (nextService <= 0) return false;
      return nextService - hours <= 150;
    }).length;
    const fleetUtilizationPct = equipmentRows.length > 0 ? Math.round((activeEquipmentCount / equipmentRows.length) * 100) : 0;

    const safetyCount = safetyCountResult.error ? 0 : safetyCountResult.count ?? 0;

    const stats = await getStatsForRole({ supabase, companyId, userId, role });

    const workOrderItems = (openWorkOrdersResult.data ?? []).map((row) => ({
      id: String(row.id),
      title: String(row.title ?? "Work Order"),
      href: `/maintenance`,
      assignedTo: row.assigned_to,
    }));

    const openWorkOrdersCount = openWorkOrdersCountResult.count ?? workOrderItems.length;

    const inventoryRows = inventoryLowPartsResult.error ? [] : inventoryLowPartsResult.data ?? [];
    const lowPartsCount = inventoryRows.filter((row) => {
      const qty = asNumber(row.quantity_on_hand);
      const reorder = asNumber(row.reorder_point);
      if (reorder <= 0) return false;
      return qty <= reorder;
    }).length;

    const onboardingRows = onboardingResult.error
      ? (isMissingOnboardingTable(onboardingResult.error.message) ? listFallbackChecklistRows(companyId) : [])
      : onboardingResult.data ?? [];
    const completedMap = new Map<string, { completed_at: string | null }>();
    for (const row of onboardingRows) {
      const key = `${String(row.key)}::${row.user_id ? String(row.user_id) : "__company__"}`;
      completedMap.set(key, { completed_at: row.completed_at });
    }
    const onboardingDismissed = Boolean(completedMap.get(`${ONBOARDING_DISMISSED_KEY}::${userId}`)?.completed_at);
    const roleChecklistItems = getOnboardingChecklistItemsForRole(role, { permissions: modulePermissions });
    const companyProfile = companyResult.error ? null : companyResult.data;
    const derivedChecklistCompleted: Record<string, boolean> = {
      complete_company_settings: isCompanyDerivedComplete(companyProfile),
      upload_company_logo: Boolean(String(companyProfile?.company_logo ?? "").trim()),
      set_company_timezone: Boolean(String(companyProfile?.timezone ?? "").trim()),
      invite_teammate: (employeesCountResult.error ? 0 : employeesCountResult.count ?? 0) > 1,
      configure_permissions: (employeesCountResult.error ? 0 : employeesCountResult.count ?? 0) > 1,
      connect_integrations: (integrationsCountResult.error ? 0 : integrationsCountResult.count ?? 0) > 0,
      finish_profile: isProfileDerivedComplete(profile, ""),
      complete_account_settings: isAccountDerivedComplete(profile),
      create_first_job: activeJobsCount > 0,
      create_first_bid: (totalBidsCountResult.error ? 0 : totalBidsCountResult.count ?? 0) > 0,
      send_first_proposal: (sentBidsCountResult.error ? 0 : sentBidsCountResult.count ?? 0) > 0,
      add_first_equipment: equipmentRows.length > 0,
      create_first_po: (purchaseOrdersCountResult.error ? 0 : purchaseOrdersCountResult.count ?? 0) > 0,
      submit_first_daily_report: (dailyReportsByUserCountResult.error ? 0 : dailyReportsByUserCountResult.count ?? 0) > 0,
      submit_first_safety_log: (safetyLogsByUserCountResult.error ? 0 : safetyLogsByUserCountResult.count ?? 0) > 0,
      upload_first_photo: false,
      close_first_work_order: false,
    };
    const checklistItems = roleChecklistItems.map((item) => ({
      key: item.key,
      label: item.label,
      description: item.description,
      view: item.view,
      href: item.href,
      scope: item.scope,
      completed: Boolean(
        completedMap.get(`${item.key}::${item.scope === "company" ? "__company__" : userId}`)?.completed_at
      ) || Boolean(derivedChecklistCompleted[item.key]),
    }));
    const completedCount = checklistItems.filter((item) => item.completed).length;

    const kpis: DashboardSummary["kpis"] = [];
    const sections: DashboardSummary["sections"] = {};
    const weather = await getDashboardWeather();
    const weatherSection = {
      enabled: true,
      mode: weather.mode,
      locationLabel: weather.locationLabel,
      item: {
        tempF: weather.tempF,
        condition: weather.condition,
        ...(weather.note ? { note: weather.note } : {}),
      },
    } as const;

    if (role === "admin") {
      kpis.push(
        { key: "active_jobs", label: "Active Jobs", value: stats.active_jobs?.value ?? 0, sublabel: `${activeJobsCount} currently in progress`, href: stats.active_jobs?.href, visible: stats.active_jobs?.visible },
        { key: "fleet_utilization", label: "Fleet Utilization", value: stats.fleet_utilization?.value ?? `${fleetUtilizationPct}%`, sublabel: `${activeEquipmentCount} of ${equipmentRows.length} active`, trendPct: 5, href: stats.fleet_utilization?.href, visible: stats.fleet_utilization?.visible },
        { key: "crew_on_site", label: "Crew On-Site", value: stats.crew_on_site?.value ?? (employeesOnSiteCountResult.count ?? 0), href: stats.crew_on_site?.href, visible: stats.crew_on_site?.visible },
        { key: "month_revenue", label: "Month Revenue", value: stats.month_revenue?.value ?? "$0", trendPct: 12, href: stats.month_revenue?.href, visible: stats.month_revenue?.visible }
      );

      sections.activeJobs = {
        items: activeJobsItems.map((item) => ({
          id: item.id,
          title: item.title,
          href: item.href,
          sublabel: item.sublabel,
        })),
        viewAllHref: "/jobs",
      };
      sections.gettingStarted = {
        enabled: !onboardingDismissed,
        items: checklistItems,
        completedCount,
        totalCount: checklistItems.length,
        dismissed: onboardingDismissed,
      };
      sections.quickActions = {
        items: [
          { key: "add_event", label: "Add Event", href: "calendar-event" },
          { key: "time_clock", label: "Time Clock", href: "time-clock" },
          { key: "check_in", label: "Check-In", href: "equipment-checkin" },
          { key: "daily_report", label: "Daily Report", href: "daily-report" },
          { key: "work_order", label: "Work Order", href: "work-order" },
          { key: "safety_sign_off", label: "Safety Sign-Off", href: "safety" },
        ],
      };
      sections.alerts = {
        items: [
          { key: "maintenance_due", label: "Maintenance Due Soon", value: maintenanceDueSoonCount, href: "/maintenance" },
          { key: "safety_7d", label: "Safety Logs (7d)", value: safetyCount, href: "/safety" },
        ],
      };
      sections.weather = weatherSection;
      sections.equipmentLocations = { enabled: true, mode: "placeholder" };
      sections.openWorkOrders = {
        items: workOrderItems.map((item) => ({
          id: item.id,
          title: item.title,
          href: item.href,
        })),
        viewAllHref: "/maintenance",
      };
    }

    if (role === "pm") {
      kpis.push(
        { key: "active_jobs", label: "Active Jobs", value: stats.active_jobs?.value ?? activeJobsCount, href: stats.active_jobs?.href, visible: stats.active_jobs?.visible },
        { key: "fleet_utilization", label: "Fleet Utilization", value: stats.fleet_utilization?.value ?? `${fleetUtilizationPct}%`, sublabel: `${activeEquipmentCount} of ${equipmentRows.length} active`, href: stats.fleet_utilization?.href, visible: stats.fleet_utilization?.visible },
        { key: "crew_on_site", label: "Crew On-Site", value: stats.crew_on_site?.value ?? (employeesOnSiteCountResult.count ?? 0), href: stats.crew_on_site?.href, visible: stats.crew_on_site?.visible }
      );

      sections.activeJobs = {
        items: activeJobsItems.map((item) => ({
          id: item.id,
          title: item.title,
          href: item.href,
          sublabel: item.sublabel,
        })),
        viewAllHref: "/jobs",
      };
      sections.gettingStarted = {
        enabled: !onboardingDismissed,
        items: checklistItems,
        completedCount,
        totalCount: checklistItems.length,
        dismissed: onboardingDismissed,
      };
      sections.quickActions = {
        items: [
          { key: "add_event", label: "Add Event", href: "calendar-event" },
          { key: "time_clock", label: "Time Clock", href: "time-clock" },
          { key: "check_in", label: "Check-In", href: "equipment-checkin" },
          { key: "daily_report", label: "Daily Report", href: "daily-report" },
          { key: "work_order", label: "Work Order", href: "work-order" },
          { key: "safety_sign_off", label: "Safety Sign-Off", href: "safety" },
        ],
      };
      sections.alerts = {
        items: [
          { key: "maintenance_due", label: "Maintenance Due Soon", value: maintenanceDueSoonCount, href: "/maintenance" },
          { key: "safety_7d", label: "Safety Logs (7d)", value: safetyCount, href: "/safety" },
        ],
      };
      sections.weather = weatherSection;
      sections.equipmentLocations = { enabled: true, mode: "placeholder" };
      sections.openWorkOrders = {
        items: workOrderItems.map((item) => ({
          id: item.id,
          title: item.title,
          href: item.href,
        })),
        viewAllHref: "/maintenance",
      };
    }

    if (role === "foreman") {
      kpis.push(
        { key: "my_active_jobs", label: "My Active Jobs", value: stats.my_active_jobs?.value ?? activeJobsCount, href: stats.my_active_jobs?.href, visible: stats.my_active_jobs?.visible },
        { key: "crew_assigned_today", label: "Crew Assigned Today", value: stats.crew_assigned_today?.value ?? (employeesOnSiteCountResult.count ?? 0), href: stats.crew_assigned_today?.href, visible: stats.crew_assigned_today?.visible },
        { key: "safety_7d", label: "Safety Logs (7d)", value: stats.safety_7d?.value ?? safetyCount, href: stats.safety_7d?.href, visible: stats.safety_7d?.visible },
        { key: "unread_messages", label: "Unread Messages", value: stats.unread_messages?.value ?? 0, href: stats.unread_messages?.href, visible: stats.unread_messages?.visible }
      );

      sections.activeJobs = {
        items: activeJobsItems.map((item) => ({
          id: item.id,
          title: item.title,
          href: item.href,
          sublabel: item.sublabel,
        })),
        viewAllHref: "/jobs",
      };
      sections.gettingStarted = {
        enabled: !onboardingDismissed,
        items: checklistItems,
        completedCount,
        totalCount: checklistItems.length,
        dismissed: onboardingDismissed,
      };
      sections.quickActions = {
        items: [
          { key: "time_clock", label: "Time Clock", href: "time-clock" },
          { key: "check_in", label: "Check-In", href: "equipment-checkin" },
          { key: "daily_report", label: "Daily Report", href: "daily-report" },
          { key: "safety_sign_off", label: "Safety Sign-Off", href: "safety" },
        ],
      };
      sections.alerts = {
        items: [
          { key: "safety_7d", label: "Safety Logs (7d)", value: safetyCount, href: "/safety" },
          { key: "unread_messages", label: "Unread Messages", value: Number(stats.unread_messages?.value ?? 0), href: "/messages" },
        ],
      };
      sections.weather = weatherSection;
      sections.equipmentLocations = { enabled: false, mode: "placeholder" };
    }

    if (role === "mechanic") {
      kpis.push(
        { key: "open_work_orders", label: "Open Work Orders", value: stats.open_work_orders?.value ?? openWorkOrdersCount, href: stats.open_work_orders?.href, visible: stats.open_work_orders?.visible },
        { key: "maintenance_due_soon", label: "Maintenance Due Soon", value: stats.maintenance_due_soon?.value ?? maintenanceDueSoonCount, href: stats.maintenance_due_soon?.href, visible: stats.maintenance_due_soon?.visible },
        { key: "equipment_down", label: "Equipment Down", value: stats.equipment_down?.value ?? equipmentDownCount, href: stats.equipment_down?.href, visible: stats.equipment_down?.visible },
        { key: "parts_low", label: "Parts Low", value: stats.parts_low?.value ?? lowPartsCount, href: stats.parts_low?.href, visible: stats.parts_low?.visible }
      );

      sections.gettingStarted = {
        enabled: !onboardingDismissed,
        items: checklistItems,
        completedCount,
        totalCount: checklistItems.length,
        dismissed: onboardingDismissed,
      };
      sections.quickActions = {
        items: [{ key: "work_order", label: "Work Order", href: "work-order" }],
      };
      sections.alerts = {
        items: [
          { key: "maintenance_due", label: "Maintenance Due Soon", value: maintenanceDueSoonCount, href: "/maintenance" },
          { key: "parts_low", label: "Parts Low", value: lowPartsCount, href: "/inventory" },
        ],
      };
      sections.equipmentLocations = { enabled: true, mode: "placeholder" };
      sections.openWorkOrders = {
        items: workOrderItems.map((item) => ({
          id: item.id,
          title: item.title,
          href: item.href,
        })),
        viewAllHref: "/maintenance",
      };
    }

    if (role === "operator") {
      kpis.push(
        { key: "my_jobs_today", label: "My Jobs Today", value: stats.my_jobs_today?.value ?? activeJobsCount, href: stats.my_jobs_today?.href, visible: stats.my_jobs_today?.visible },
        { key: "hours_today", label: "Hours Today", value: stats.hours_today?.value ?? 0, href: stats.hours_today?.href, visible: stats.hours_today?.visible },
        { key: "safety_items_7d", label: "Safety Items (7d)", value: stats.safety_items_7d?.value ?? safetyCount, href: stats.safety_items_7d?.href, visible: stats.safety_items_7d?.visible },
        { key: "unread_messages", label: "Unread Messages", value: stats.unread_messages?.value ?? 0, href: stats.unread_messages?.href, visible: stats.unread_messages?.visible }
      );

      sections.activeJobs = {
        items: activeJobsItems.map((item) => ({
          id: item.id,
          title: item.title,
          href: item.href,
          sublabel: item.sublabel,
        })),
        viewAllHref: "/jobs",
      };
      sections.gettingStarted = {
        enabled: !onboardingDismissed,
        items: checklistItems,
        completedCount,
        totalCount: checklistItems.length,
        dismissed: onboardingDismissed,
      };
      sections.quickActions = {
        items: [
          { key: "time_clock", label: "Time Clock", href: "time-clock" },
          { key: "daily_report", label: "Daily Report", href: "daily-report" },
          { key: "safety_sign_off", label: "Safety Sign-Off", href: "safety" },
        ],
      };
      sections.alerts = {
        items: [
          { key: "safety_7d", label: "Safety Items (7d)", value: safetyCount, href: "/safety" },
          { key: "unread_messages", label: "Unread Messages", value: Number(stats.unread_messages?.value ?? 0), href: "/messages" },
        ],
      };
      sections.weather = weatherSection;
      sections.equipmentLocations = { enabled: false, mode: "placeholder" };
    }

    const item: DashboardSummary = {
      role,
      kpis,
      sections,
    };

    return NextResponse.json({ item });
  } catch (error) {
    return toError(error);
  }
}
