import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppRole } from '@/lib/nav/config';

const ACTIVE_JOB_STATUSES = ['active', 'open', 'in_progress'];
const OPEN_WORK_ORDER_STATUSES = ['open', 'scheduled', 'in-progress', 'in_progress'];

type StatValue = number | string;

export type StatEntry = {
  value: StatValue;
  href: string | null;
  visible: boolean;
};

export type DashboardStatKey =
  | 'active_jobs'
  | 'my_active_jobs'
  | 'my_jobs_today'
  | 'fleet_utilization'
  | 'crew_on_site'
  | 'crew_assigned_today'
  | 'month_revenue'
  | 'safety_7d'
  | 'safety_items_7d'
  | 'unread_messages'
  | 'open_work_orders'
  | 'maintenance_due_soon'
  | 'equipment_down'
  | 'parts_low'
  | 'hours_today';

export type DashboardStats = Partial<Record<DashboardStatKey, StatEntry>>;

const asNumber = (value: unknown) => {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
};

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);

function isMissingTable(message: string, table: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes(table) &&
    (normalized.includes('does not exist') || normalized.includes('not find'))
  );
}

export async function getStatsForRole({
  supabase,
  companyId,
  userId,
  role,
}: {
  supabase: SupabaseClient;
  companyId: string;
  userId: string;
  role: AppRole;
}): Promise<DashboardStats> {
  const now = new Date();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(now.getDate() - 7);

  const [
    activeJobsCountResult,
    equipmentResult,
    employeesOnSiteCountResult,
    safetyCountResult,
    openWorkOrdersCountResult,
    inventoryLowPartsResult,
    unreadNotificationsResult,
    acceptedBidsResult,
  ] = await Promise.all([
    supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .in('status', ACTIVE_JOB_STATUSES),
    supabase
      .from('equipment')
      .select('status, hours, current_hours, meter_hours, next_service, nextService, service_due_hours')
      .eq('company_id', companyId),
    supabase
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('status', 'clocked-in'),
    supabase
      .from('safety_logs')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .gte('occurred_on', sevenDaysAgo.toISOString().slice(0, 10)),
    supabase
      .from('work_orders')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .in('status', OPEN_WORK_ORDER_STATUSES),
    supabase.from('inventory').select('quantity_on_hand, reorder_point').eq('company_id', companyId),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .is('read_at', null),
    supabase
      .from('bids')
      .select('revenue')
      .eq('company_id', companyId)
      .in('status', ['accepted', 'approved']),
  ]);

  if (activeJobsCountResult.error && !isMissingTable(activeJobsCountResult.error.message, 'jobs')) {
    throw new Error(activeJobsCountResult.error.message);
  }
  if (equipmentResult.error && !isMissingTable(equipmentResult.error.message, 'equipment')) {
    throw new Error(equipmentResult.error.message);
  }
  if (employeesOnSiteCountResult.error && !isMissingTable(employeesOnSiteCountResult.error.message, 'employees')) {
    throw new Error(employeesOnSiteCountResult.error.message);
  }
  if (openWorkOrdersCountResult.error && !isMissingTable(openWorkOrdersCountResult.error.message, 'work_orders')) {
    throw new Error(openWorkOrdersCountResult.error.message);
  }

  const equipmentRows = equipmentResult.error ? [] : equipmentResult.data ?? [];
  const activeEquipmentCount = equipmentRows.filter((row) => String(row.status ?? '') === 'active').length;
  const equipmentDownCount = equipmentRows.filter((row) => {
    const status = String(row.status ?? '');
    return status === 'maintenance' || status === 'out_of_service';
  }).length;
  const maintenanceDueSoonCount = equipmentRows.filter((row) => {
    const hours = asNumber(row.hours ?? row.current_hours ?? row.meter_hours ?? 0);
    const nextService = asNumber(row.next_service ?? row.nextService ?? row.service_due_hours ?? 0);
    if (nextService <= 0) return false;
    return nextService - hours <= 150;
  }).length;
  const fleetUtilizationPct = equipmentRows.length > 0 ? Math.round((activeEquipmentCount / equipmentRows.length) * 100) : 0;

  const inventoryRows = inventoryLowPartsResult.error ? [] : inventoryLowPartsResult.data ?? [];
  const lowPartsCount = inventoryRows.filter((row) => {
    const qty = asNumber(row.quantity_on_hand);
    const reorder = asNumber(row.reorder_point);
    if (reorder <= 0) return false;
    return qty <= reorder;
  }).length;

  const monthlyRevenue = acceptedBidsResult.error
    ? 0
    : (acceptedBidsResult.data ?? []).reduce((sum, row) => sum + asNumber(row.revenue), 0);

  const activeJobs = activeJobsCountResult.error ? 0 : activeJobsCountResult.count ?? 0;
  const unreadMessages = unreadNotificationsResult.error ? 0 : unreadNotificationsResult.count ?? 0;
  const crewOnSite = employeesOnSiteCountResult.error ? 0 : employeesOnSiteCountResult.count ?? 0;
  const safety7d = safetyCountResult.error ? 0 : safetyCountResult.count ?? 0;
  const openWorkOrders = openWorkOrdersCountResult.error ? 0 : openWorkOrdersCountResult.count ?? 0;

  return {
    active_jobs: { value: activeJobs, href: '/jobs?status=active', visible: role === 'admin' || role === 'pm' },
    my_active_jobs: { value: activeJobs, href: '/jobs?status=active', visible: role === 'foreman' },
    my_jobs_today: { value: activeJobs, href: '/schedule?view=today', visible: role === 'operator' },
    fleet_utilization: { value: `${fleetUtilizationPct}%`, href: '/fleet', visible: role === 'admin' || role === 'pm' },
    crew_on_site: { value: crewOnSite, href: '/team?status=clocked-in', visible: role === 'admin' || role === 'pm' },
    crew_assigned_today: { value: crewOnSite, href: '/schedule?view=today', visible: role === 'foreman' },
    month_revenue: { value: formatCurrency(monthlyRevenue), href: '/bids', visible: role === 'admin' },
    safety_7d: { value: safety7d, href: '/safety?range=7d', visible: role === 'foreman' },
    safety_items_7d: { value: safety7d, href: '/safety?range=7d', visible: role === 'operator' },
    unread_messages: { value: unreadMessages, href: '/messages', visible: role === 'foreman' || role === 'operator' },
    open_work_orders: { value: openWorkOrders, href: '/maintenance/work-orders?status=open', visible: role === 'mechanic' },
    maintenance_due_soon: { value: maintenanceDueSoonCount, href: '/maintenance/work-orders?status=open', visible: role === 'mechanic' },
    equipment_down: { value: equipmentDownCount, href: '/fleet?status=out_of_service', visible: role === 'mechanic' },
    parts_low: { value: lowPartsCount, href: '/inventory?filter=low-stock', visible: role === 'mechanic' },
    hours_today: { value: crewOnSite, href: '/schedule?view=today', visible: role === 'operator' },
  };
}
