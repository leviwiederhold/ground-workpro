import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { cookies } from "next/headers";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import {
  ONBOARDING_DISMISSED_KEY,
  getOnboardingChecklistItemsForRole,
} from "@/lib/onboarding/checklist";

export const dynamic = "force-dynamic";

type Role = "admin" | "pm" | "foreman" | "mechanic" | "operator";

type DashboardSummary = {
  role: Role;
  kpis: Array<{
    key: string;
    label: string;
    value: number | string;
    sublabel?: string;
    trendPct?: number | null;
  }>;
  sections: {
    activeJobs?: {
      items: Array<{ id: string; title: string; href: string; sublabel?: string }>;
      viewAllHref?: string;
    };
    gettingStarted?: {
      enabled: boolean;
      items: Array<{ key: string; label: string; completed: boolean }>;
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
      mode: "placeholder";
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

const roleSchema = z.enum(["admin", "pm", "foreman", "mechanic", "operator"]);
function normalizeRole(rawRole: unknown): Role | null {
  const parsed = roleSchema.safeParse(rawRole);
  if (parsed.success) return parsed.data;

  const normalized = String(rawRole ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z]/g, "");

  if (!normalized) return null;

  if (normalized.includes("admin")) return "admin";
  if (normalized.includes("executive")) return "admin";
  if (normalized.includes("ceo")) return "admin";
  if (normalized.includes("operations")) return "pm";
  if (normalized === "pm" || normalized.includes("projectmanager")) return "pm";
  if (normalized.includes("foreman")) return "foreman";
  if (normalized.includes("mechanic")) return "mechanic";
  if (normalized.includes("operator")) return "operator";
  if (normalized.includes("field")) return "operator";

  return null;
}

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

const ACTIVE_JOB_STATUSES = ["active", "open", "in_progress"];
const OPEN_WORK_ORDER_STATUSES = ["open", "scheduled", "in-progress", "in_progress"];

function toError(error: unknown) {
  if (error instanceof TenantResolverError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Internal server error";
  return NextResponse.json({ error: message || "Internal server error" }, { status: 500 });
}

async function resolveRole(
  supabase: Awaited<ReturnType<typeof getCompanyId>>["supabase"],
  companyId: string,
  userId: string
): Promise<Role> {
  const { data, error } = await supabase
    .from("memberships")
    .select("role")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .limit(1);

  if (error) {
    throw new Error(error.message);
  }

  const normalizedRole = normalizeRole(data?.[0]?.role);
  if (!normalizedRole) {
    throw new TenantResolverError("Forbidden", 403);
  }

  return normalizedRole;
}

export async function GET() {
  try {
    const { supabase, companyId, userId } = await getCompanyId();
    const cookieStore = await cookies();
    const testRoleOverride = process.env.E2E === "true" ? cookieStore.get("e2e_role")?.value : undefined;
    const role = normalizeRole(testRoleOverride) ?? (await resolveRole(supabase, companyId, userId));

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
      .select("key, completed_at")
      .eq("company_id", companyId);

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
    const unreadMessages = 0;
    const monthRevenuePlaceholder = 847500;
    const hoursTodayPlaceholder = 0;

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

    const onboardingRows = onboardingResult.error ? [] : onboardingResult.data ?? [];
    const completedMap = new Map<string, { completed_at: string | null }>();
    for (const row of onboardingRows) {
      completedMap.set(String(row.key), { completed_at: row.completed_at });
    }
    const onboardingDismissed = Boolean(completedMap.get(ONBOARDING_DISMISSED_KEY)?.completed_at);
    const roleChecklistItems = getOnboardingChecklistItemsForRole(role);
    const checklistItems = roleChecklistItems.map((item) => ({
      key: item.key,
      label: item.label,
      completed: Boolean(completedMap.get(item.key)?.completed_at),
    }));
    const completedCount = checklistItems.filter((item) => item.completed).length;

    const kpis: DashboardSummary["kpis"] = [];
    const sections: DashboardSummary["sections"] = {};

    if (role === "admin") {
      kpis.push(
        { key: "active_jobs", label: "Active Jobs", value: activeJobsCount, sublabel: `${activeJobsCount} currently in progress` },
        { key: "fleet_utilization", label: "Fleet Utilization", value: `${fleetUtilizationPct}%`, sublabel: `${activeEquipmentCount} of ${equipmentRows.length} active`, trendPct: 5 },
        { key: "crew_on_site", label: "Crew On-Site", value: employeesOnSiteCountResult.count ?? 0 },
        { key: "month_revenue", label: "Month Revenue", value: formatCurrency(monthRevenuePlaceholder), sublabel: "deterministic placeholder", trendPct: 12 }
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
      sections.weather = {
        enabled: true,
        mode: "placeholder",
        locationLabel: "Cincinnati",
        item: { tempF: 47, condition: "Partly Cloudy", note: "Not connected to external weather provider" },
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

    if (role === "pm") {
      kpis.push(
        { key: "active_jobs", label: "Active Jobs", value: activeJobsCount },
        { key: "fleet_utilization", label: "Fleet Utilization", value: `${fleetUtilizationPct}%`, sublabel: `${activeEquipmentCount} of ${equipmentRows.length} active` },
        { key: "crew_on_site", label: "Crew On-Site", value: employeesOnSiteCountResult.count ?? 0 }
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
      sections.weather = {
        enabled: true,
        mode: "placeholder",
        locationLabel: "Cincinnati",
        item: { tempF: 47, condition: "Partly Cloudy", note: "Not connected to external weather provider" },
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

    if (role === "foreman") {
      kpis.push(
        { key: "my_active_jobs", label: "My Active Jobs", value: activeJobsCount },
        { key: "crew_assigned_today", label: "Crew Assigned Today", value: employeesOnSiteCountResult.count ?? 0 },
        { key: "safety_7d", label: "Safety Logs (7d)", value: safetyCount },
        { key: "unread_messages", label: "Unread Messages", value: unreadMessages }
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
          { key: "unread_messages", label: "Unread Messages", value: unreadMessages, href: "/messages" },
        ],
      };
      sections.weather = {
        enabled: true,
        mode: "placeholder",
        locationLabel: "Cincinnati",
        item: { tempF: 47, condition: "Partly Cloudy", note: "Not connected to external weather provider" },
      };
      sections.equipmentLocations = { enabled: false, mode: "placeholder" };
    }

    if (role === "mechanic") {
      kpis.push(
        { key: "open_work_orders", label: "Open Work Orders", value: openWorkOrdersCount },
        { key: "maintenance_due_soon", label: "Maintenance Due Soon", value: maintenanceDueSoonCount },
        { key: "equipment_down", label: "Equipment Down", value: equipmentDownCount },
        { key: "parts_low", label: "Parts Low", value: lowPartsCount }
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
        { key: "my_jobs_today", label: "My Jobs Today", value: activeJobsCount },
        { key: "hours_today", label: "Hours Today", value: hoursTodayPlaceholder },
        { key: "safety_items_7d", label: "Safety Items (7d)", value: safetyCount },
        { key: "unread_messages", label: "Unread Messages", value: unreadMessages }
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
          { key: "unread_messages", label: "Unread Messages", value: unreadMessages, href: "/messages" },
        ],
      };
      sections.weather = {
        enabled: true,
        mode: "placeholder",
        locationLabel: "Cincinnati",
        item: { tempF: 47, condition: "Partly Cloudy", note: "Not connected to external weather provider" },
      };
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
