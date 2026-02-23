/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-unused-vars */
// @ts-nocheck
'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState, SkeletonBlock, InlineError } from '@/app/components/ui/FeedbackBlocks';

const KPI_ICON_BY_KEY = {
  active_jobs: { icon: 'briefcase', color: 'brand' },
  my_active_jobs: { icon: 'briefcase', color: 'brand' },
  my_jobs_today: { icon: 'briefcase', color: 'brand' },
  fleet_utilization: { icon: 'truck-monster', color: 'green' },
  crew_on_site: { icon: 'users', color: 'blue' },
  crew_assigned_today: { icon: 'users', color: 'blue' },
  month_revenue: { icon: 'dollar-sign', color: 'green' },
  safety_7d: { icon: 'shield-halved', color: 'yellow' },
  safety_items_7d: { icon: 'shield-halved', color: 'yellow' },
  unread_messages: { icon: 'message', color: 'blue' },
  open_work_orders: { icon: 'wrench', color: 'yellow' },
  maintenance_due_soon: { icon: 'triangle-exclamation', color: 'yellow' },
  equipment_down: { icon: 'screwdriver-wrench', color: 'red' },
  parts_low: { icon: 'boxes-stacked', color: 'red' },
  hours_today: { icon: 'clock', color: 'blue' },
};

const ACTION_ICON_BY_KEY = {
  add_event: 'calendar-plus',
  time_clock: 'clock',
  check_in: 'clipboard-check',
  daily_report: 'file-lines',
  work_order: 'wrench',
  safety_sign_off: 'shield-halved',
};

export function DashboardView({ jobs, jobsLoading, equipment, employees, workOrders, inventory, currentRole, setCurrentView, setShowModal, ui }) {
  const { StatGrid, StatCard, Card, Button, Icon, Badge, ProgressBar } = ui;

  const [dashboardSummary, setDashboardSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState('');

  const [onboardingItems, setOnboardingItems] = useState([]);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [onboardingSavingKey, setOnboardingSavingKey] = useState('');
  const [onboardingDismissSaving, setOnboardingDismissSaving] = useState(false);
  const [onboardingResetLoading, setOnboardingResetLoading] = useState(false);
  const [onboardingError, setOnboardingError] = useState('');

  const effectiveRole = dashboardSummary?.role ?? currentRole;

  const completedCount = useMemo(
    () => onboardingItems.filter((item) => item.completed).length,
    [onboardingItems]
  );
  const totalCount = onboardingItems.length;
  const completionPercent = totalCount ? Math.round((completedCount / totalCount) * 100) : 0;

  const loadDashboardSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError('');
    try {
      const response = await fetch('/api/dashboard', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setSummaryError(payload?.error || 'Failed to load dashboard summary.');
        return;
      }

      const item = payload?.item ?? null;
      setDashboardSummary(item);

      const gettingStarted = (item?.sections?.primary?.items || []).find((entry) => entry.type === 'getting_started')?.meta;
      if (gettingStarted) {
        setOnboardingItems(
          Array.isArray(gettingStarted.items)
            ? gettingStarted.items.map((entry) => ({
                key: entry.key,
                label: entry.label,
                description: entry.description ?? '',
                view: entry.view ?? 'dashboard',
                completed: Boolean(entry.completed),
              }))
            : []
        );
        setOnboardingDismissed(Boolean(gettingStarted.dismissed) || gettingStarted.enabled === false);
      }
    } catch {
      setSummaryError('Failed to load dashboard summary.');
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboardSummary();
  }, [loadDashboardSummary]);

  const completeChecklistItem = async (key, completed) => {
    setOnboardingSavingKey(key);
    setOnboardingError('');
    try {
      const response = await fetch('/api/onboarding/checklist/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, completed }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setOnboardingError(payload?.error || 'Failed to update checklist item.');
        return;
      }
      await loadDashboardSummary();
    } catch {
      setOnboardingError('Failed to update checklist item.');
    } finally {
      setOnboardingSavingKey('');
    }
  };

  const setDismissedState = async (dismissed) => {
    setOnboardingDismissSaving(true);
    setOnboardingError('');
    try {
      const response = await fetch('/api/onboarding/checklist/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dismissed }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setOnboardingError(payload?.error || 'Failed to update checklist visibility.');
        return;
      }
      setOnboardingDismissed(Boolean(payload?.item?.dismissed));
      await loadDashboardSummary();
    } catch {
      setOnboardingError('Failed to update checklist visibility.');
    } finally {
      setOnboardingDismissSaving(false);
    }
  };

  const resetChecklist = async () => {
    setOnboardingResetLoading(true);
    setOnboardingError('');
    try {
      const response = await fetch('/api/onboarding/checklist/reset', { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setOnboardingError(payload?.error || 'Failed to reset checklist.');
        return;
      }
      await loadDashboardSummary();
    } catch {
      setOnboardingError('Failed to reset checklist.');
    } finally {
      setOnboardingResetLoading(false);
    }
  };


  const navigateToHref = (href) => {
    if (!href) return;
    const [path] = href.split('?');
    const routeMap = {
      '/jobs': 'jobs',
      '/maintenance': 'maintenance',
      '/maintenance/work-orders': 'maintenance',
      '/safety': 'safety',
      '/messages': 'messages',
      '/inventory': 'inventory',
      '/fleet': 'fleet',
      '/team': 'team',
      '/schedule': 'schedule',
      '/bids': 'bids',
    };
    setCurrentView(routeMap[path] ?? 'dashboard');
  };

  const goToChecklistItem = (item) => {
    if (item?.view) {
      setCurrentView(item.view);
    }
  };

  const runQuickAction = (action) => {
    if (!action?.href) return;
    const modalMap = {
      'calendar-event': { type: 'calendar-event' },
      'time-clock': { type: 'time-clock' },
      'equipment-checkin': { type: 'equipment-checkin' },
      'daily-report': { type: 'daily-report' },
      'work-order': { type: 'work-order' },
      safety: { type: 'safety' },
    };
    if (modalMap[action.href]) {
      setShowModal(modalMap[action.href]);
      return;
    }
    if (action.href.startsWith('/')) {
      const routeMap = {
        '/jobs': 'jobs',
        '/maintenance': 'maintenance',
        '/safety': 'safety',
        '/messages': 'messages',
        '/inventory': 'inventory',
        '/schedule': 'schedule',
        '/fleet': 'fleet',
      };
      setCurrentView(routeMap[action.href] ?? 'dashboard');
    }
  };

  const kpis = (dashboardSummary?.kpis ?? []).filter((kpi) => kpi.visible !== false);
  const primaryItems = dashboardSummary?.sections?.primary?.items ?? [];
  const activeJobsSection = dashboardSummary?.sections?.activeJobs ?? primaryItems.find((item) => item.type === 'active_jobs')?.meta;
  const quickActionsSection = dashboardSummary?.sections?.quickActions ?? primaryItems.find((item) => item.type === 'quick_actions')?.meta;
  const gettingStartedSection = dashboardSummary?.sections?.gettingStarted ?? primaryItems.find((item) => item.type === 'getting_started')?.meta;
  const alertsSection = dashboardSummary?.sections?.alerts;
  const weatherSection = dashboardSummary?.sections?.weather ?? dashboardSummary?.weather;
  const weatherVisible = Boolean(weatherSection?.visible ?? weatherSection?.enabled);
  const weatherTempF = weatherSection?.tempF ?? weatherSection?.item?.tempF;
  const weatherCondition = weatherSection?.condition ?? weatherSection?.item?.condition;
  const weatherHighF = weatherSection?.highF ?? null;
  const weatherLowF = weatherSection?.lowF ?? null;
  const equipmentLocationsSection = dashboardSummary?.sections?.equipmentLocations ?? primaryItems.find((item) => item.type === 'equipment_locations')?.meta;
  const openWorkOrdersSection = dashboardSummary?.sections?.openWorkOrders ?? primaryItems.find((item) => item.type === 'open_work_orders')?.meta;
  const showGettingStarted = Boolean(gettingStartedSection?.enabled ?? gettingStartedSection);
  const isAdminDashboard = effectiveRole === 'admin';

  const rolePrimaryItems = !isAdminDashboard
    ? primaryItems.filter((item) => !['active_jobs', 'quick_actions', 'getting_started', 'equipment_locations', 'open_work_orders'].includes(item.type))
    : [];

  if (summaryLoading && !dashboardSummary) {
    return (
      <div className="space-y-6">
        <SkeletonBlock lines={4} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {summaryError && <InlineError>{summaryError}</InlineError>}

      <StatGrid desktopColsClass="md:grid-cols-2 lg:grid-cols-4" testId="stats-grid">
        {kpis.map((kpi) => {
          const visual = KPI_ICON_BY_KEY[kpi.key] || { icon: 'chart-line', color: 'brand' };
          return (
            <StatCard
              key={kpi.key}
              icon={visual.icon}
              label={kpi.label}
              value={kpi.value}
              color={visual.color}
              href={kpi.href ?? undefined}
              onClick={() => navigateToHref(kpi.href)}
              testId={`stat-card-${kpi.key}`}
            />
          );
        })}
      </StatGrid>

      {isAdminDashboard ? (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {activeJobsSection && (
              <Card className="lg:col-span-2 p-0 overflow-hidden">
                <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900">Active Jobs</h3>
                  <Button variant="ghost" size="sm" onClick={() => setCurrentView('jobs')}>
                    View All <Icon name="arrow-right" className="ml-1" />
                  </Button>
                </div>
                <div className="divide-y divide-gray-100">
                  {activeJobsSection.items.length === 0 ? (
                    <div className="p-4">
                      <EmptyState testId="dashboard-jobs-empty">No active jobs yet.</EmptyState>
                    </div>
                  ) : (
                    activeJobsSection.items.map((job) => (
                      <div key={job.id} className="p-4 hover:bg-gray-50" onClick={() => setCurrentView('jobs')}>
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <h4 className="font-medium text-gray-900">{job.title}</h4>
                            <p className="text-sm text-gray-500">{job.sublabel || 'Active project'}</p>
                          </div>
                          <Badge variant="info">Active</Badge>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </Card>
            )}

            <div className="space-y-6">
              {showGettingStarted && (
                <Card className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-gray-900">
                      <Icon name="circle-check" className="mr-2 text-brand-500" />
                      Getting Started
                    </h3>
                    <Button variant="ghost" size="sm" disabled={onboardingDismissSaving} onClick={() => setDismissedState(!onboardingDismissed)}>
                      {onboardingDismissed ? 'Show' : 'Dismiss'}
                    </Button>
                  </div>

                  {onboardingDismissed ? (
                    <div className="text-sm text-gray-600 space-y-3">
                      <p>Checklist hidden. Rehydrate it anytime.</p>
                      <div className="flex items-center gap-2">
                        <Button variant="secondary" size="sm" disabled={onboardingDismissSaving} onClick={() => setDismissedState(false)}>
                          Rehydrate checklist
                        </Button>
                        {effectiveRole === 'admin' && (
                          <Button variant="ghost" size="sm" disabled={onboardingResetLoading} onClick={resetChecklist}>
                            Reset
                          </Button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-sm text-gray-600">
                        <span>{completedCount} of {totalCount} complete</span>
                        <span>{completionPercent}%</span>
                      </div>
                      <ProgressBar value={completionPercent} max={100} color="brand" size="sm" />
                      <div className="space-y-2">
                        {onboardingItems.map((item) => (
                          <div key={item.key} className="flex items-start gap-2 p-2 rounded-lg border border-gray-100" data-testid={`onboarding-item-${item.key}`}>
                            <button
                              type="button"
                              disabled={onboardingSavingKey === item.key}
                              data-testid={`onboarding-toggle-${item.key}`}
                              className={`mt-0.5 w-5 h-5 rounded-full border flex items-center justify-center ${item.completed ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 text-transparent'} disabled:opacity-50`}
                              onClick={() => completeChecklistItem(item.key, !item.completed)}
                            >
                              <Icon name="check" className="text-[10px]" />
                            </button>
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-medium ${item.completed ? 'text-gray-500 line-through' : 'text-gray-900'}`}>
                                {item.label}
                              </p>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => goToChecklistItem(item)}>
                              Go
                            </Button>
                          </div>
                        ))}
                      </div>
                      {onboardingError && <p className="text-sm text-red-600">{onboardingError}</p>}
                    </div>
                  )}
                </Card>
              )}

              {quickActionsSection && (
                <Card className="p-4">
                  <h3 className="font-semibold text-gray-900 mb-4">Quick Actions</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {quickActionsSection.items.map((action) => {
                      const iconName = ACTION_ICON_BY_KEY[action.key] || 'bolt';
                      const isSingleWide = quickActionsSection.items.length % 2 === 1 && quickActionsSection.items.length > 1 && action === quickActionsSection.items[quickActionsSection.items.length - 1];
                      return (
                        <Button key={action.key} variant="secondary" size="sm" className={`justify-start ${isSingleWide ? 'col-span-2' : ''}`} onClick={() => runQuickAction(action)}>
                          <Icon name={iconName} className="mr-2 text-brand-500" /> {action.label}
                        </Button>
                      );
                    })}
                  </div>
                </Card>
              )}

              {alertsSection && (
                <Card className="p-4">
                  <h3 className="font-semibold text-gray-900 mb-4">
                    <Icon name="triangle-exclamation" className="mr-2 text-yellow-500" />
                    Alerts
                  </h3>
                  <div className="space-y-3">
                    {alertsSection.items.length === 0 ? (
                      <EmptyState>No alerts.</EmptyState>
                    ) : (
                      alertsSection.items.map((alert) => (
                        <div key={alert.key || alert.type || alert.label} className="flex items-start gap-3 p-2 bg-yellow-50 rounded-lg">
                          <Icon name="triangle-exclamation" className="text-yellow-600 mt-0.5" />
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-900">{alert.message || alert.label}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </Card>
              )}

              {weatherVisible && (
                <Card className="p-4">
                  <h3 className="font-semibold text-gray-900 mb-4">
                    <Icon name="cloud-sun" className="mr-2 text-blue-500" />
                    Weather - {weatherSection.locationLabel}
                  </h3>
                  <div className="text-center mb-4">
                    <div className="flex items-center justify-center gap-4">
                      <Icon name="sun" className="text-yellow-500 text-4xl" />
                      <div>
                        <p className="text-4xl font-bold text-gray-900">{weatherTempF ?? 0}°F</p>
                        <p className="text-sm text-gray-500">{weatherCondition || 'Not connected'}</p>
                        {weatherHighF !== null && weatherLowF !== null && (
                          <p className="text-xs text-gray-400">H {weatherHighF}° / L {weatherLowF}°</p>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              )}
            </div>
          </div>

          {(equipmentLocationsSection?.enabled || openWorkOrdersSection) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {equipmentLocationsSection?.enabled && (
                <Card className="p-4">
                  <h3 className="font-semibold text-gray-900 mb-4">
                    <Icon name="map-location-dot" className="mr-2 text-brand-500" />
                    Equipment Locations - Cincinnati Area
                  </h3>
                  <div className="h-[420px] rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center">
                    <span className="text-sm text-gray-500">Location map not connected yet (deterministic placeholder)</span>
                  </div>
                </Card>
              )}

              {openWorkOrdersSection && (
                <Card className="p-0 overflow-hidden">
                  <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                    <h3 className="font-semibold text-gray-900">Open Work Orders</h3>
                    <Button variant="ghost" size="sm" onClick={() => setCurrentView('maintenance')}>
                      View All <Icon name="arrow-right" className="ml-1" />
                    </Button>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {openWorkOrdersSection.items.length === 0 ? (
                      <div className="p-4">
                        <EmptyState testId="dashboard-workorders-empty">No open work orders.</EmptyState>
                      </div>
                    ) : (
                      openWorkOrdersSection.items.map((wo) => (
                        <div key={wo.id} className="p-4 hover:bg-gray-50" onClick={() => setCurrentView('maintenance')}>
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <Icon name="circle" className="text-yellow-600" />
                                <span className="font-medium text-gray-900">{wo.title}</span>
                              </div>
                            </div>
                            <Badge className="bg-yellow-100 text-yellow-800">open</Badge>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </Card>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {rolePrimaryItems.map((section, index) => (
              <Card key={`${section.type}-${index}`} className="p-4">
                <h3 className="font-semibold text-gray-900 mb-2">{section.title}</h3>
                {section.subtitle && <p className="text-sm text-gray-600 mb-3">{section.subtitle}</p>}
                {section.meta?.item && (
                  <div className="text-sm text-gray-700 space-y-1">
                    <p><strong>{section.meta.item.jobName}</strong>{section.meta.item.address ? ` • ${section.meta.item.address}` : ''}</p>
                    <p>{section.meta.item.startTime} - {section.meta.item.endTime}</p>
                    {section.meta.item.equipment && <p>Equipment: {section.meta.item.equipment}</p>}
                  </div>
                )}
                {section.meta?.empty && <EmptyState>No assignment yet</EmptyState>}
                {Array.isArray(section.meta?.items) && (
                  <div className="space-y-2">
                    {section.meta.items.length === 0 ? (
                      <EmptyState>No items.</EmptyState>
                    ) : (
                      section.meta.items.map((item) => (
                        <div key={item.id || item.title || item.label} className="p-2 bg-gray-50 rounded-lg">
                          <p className="text-sm font-medium text-gray-900">{item.title || item.label}</p>
                          {(item.sublabel || item.status || item.priority) && (
                            <p className="text-xs text-gray-600">{item.sublabel || `${item.priority || ''} ${item.status || ''}`.trim()}</p>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </Card>
            ))}
          </div>
          <div className="space-y-6">
            {alertsSection && (
              <Card className="p-4">
                <h3 className="font-semibold text-gray-900 mb-4">Alerts</h3>
                <div className="space-y-2">
                  {alertsSection.items.length === 0 ? <EmptyState>No alerts.</EmptyState> : alertsSection.items.map((alert) => (
                    <div key={alert.key || alert.type || alert.label} className="p-2 rounded-lg bg-yellow-50 text-sm text-gray-900">{alert.message || alert.label}</div>
                  ))}
                </div>
              </Card>
            )}
            {weatherVisible && (
              <Card className="p-4">
                <h3 className="font-semibold text-gray-900 mb-4">Weather - {weatherSection.locationLabel}</h3>
                <p className="text-3xl font-bold text-gray-900">{weatherTempF ?? 0}°F</p>
                <p className="text-sm text-gray-500">{weatherCondition || 'Not connected'}</p>
                {weatherHighF !== null && weatherLowF !== null && (
                  <p className="text-xs text-gray-400">H {weatherHighF}° / L {weatherLowF}°</p>
                )}
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
