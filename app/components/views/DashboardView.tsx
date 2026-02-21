/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-unused-vars */
// @ts-nocheck
'use client';
import { EmptyState, SkeletonBlock } from '@/app/components/ui/FeedbackBlocks';

export function DashboardView({ jobs, jobsLoading, equipment, employees, workOrders, inventory, setCurrentView, setShowModal, ui }) {
  const { StatGrid, StatCard, Card, Button, Icon, Badge, ProgressBar, LeafletMap, formatCurrency, formatDate, getDaysUntil, getPriorityColor, getStatusColor } = ui;
      const activeJobs = jobs.filter(j => j.status === 'active');
      const activeEquipment = equipment.filter(e => e.status === 'active');
      const clockedInEmployees = employees.filter(e => e.status === 'clocked-in');
      const totalRevenue = jobs.reduce((sum, j) => sum + j.budget, 0);
      const totalSpent = jobs.reduce((sum, j) => sum + j.spent, 0);
      const utilizationRate = Math.round((activeEquipment.length / equipment.length) * 100);

      const upcomingMaintenance = equipment.filter(e => (e.nextService - e.hours) < 150).slice(0, 3);
      const expiringCerts = employees.flatMap(emp =>
        emp.certifications.filter(c => getDaysUntil(c.expires) < 60).map(c => ({ ...c, employee: emp.name }))
      ).slice(0, 4);

      return (
        <div className="space-y-6">
          {/* KPI Cards */}
          <StatGrid desktopColsClass="md:grid-cols-2 lg:grid-cols-4" testId="stats-grid">
            <StatCard icon="briefcase" label="Active Jobs" value={activeJobs.length} subValue={`${formatCurrency(totalRevenue)} total contract value`} color="brand" />
            <StatCard icon="truck-monster" label="Fleet Utilization" value={`${utilizationRate}%`} subValue={`${activeEquipment.length} of ${equipment.length} active`} trend={5} color="green" />
            <StatCard icon="users" label="Crew On-Site" value={clockedInEmployees.length} subValue={`of ${employees.length} total employees`} color="blue" />
            <StatCard icon="dollar-sign" label="Month Revenue" value={formatCurrency(847500)} subValue="vs. budget: +12%" trend={12} color="green" />
          </StatGrid>

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Active Jobs */}
            <Card className="lg:col-span-2 p-0 overflow-hidden">
              <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">Active Jobs</h3>
                <Button variant="ghost" size="sm" onClick={() => setCurrentView('jobs')}>
                  View All <Icon name="arrow-right" className="ml-1" />
                </Button>
              </div>
              <div className="divide-y divide-gray-100">
                {jobsLoading ? (
                  <div className="p-4">
                    <SkeletonBlock lines={3} testId="dashboard-jobs-loading" />
                  </div>
                ) : activeJobs.length === 0 ? (
                  <div className="p-4">
                    <EmptyState testId="dashboard-jobs-empty">No active jobs yet.</EmptyState>
                  </div>
                ) : (
                  activeJobs.map(job => (
                    <div key={job.id} className="p-4 hover:bg-gray-50">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h4 className="font-medium text-gray-900">{job.name}</h4>
                          <p className="text-sm text-gray-500">{job.client}</p>
                        </div>
                        <Badge variant={job.progress > 50 ? 'success' : 'warning'}>{job.progress}% Complete</Badge>
                      </div>
                      <ProgressBar value={job.progress} color="brand" size="sm" />
                      <div className="flex items-center justify-between mt-3 text-sm">
                        <span className="text-gray-500">
                          <Icon name="calendar" className="mr-1" />
                          Due {formatDate(job.endDate)}
                        </span>
                        <span className={job.spent / job.budget > 0.9 ? 'text-red-600 font-medium' : 'text-gray-600'}>
                          {formatCurrency(job.spent)} / {formatCurrency(job.budget)}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>

            {/* Quick Actions + Alerts */}
            <div className="space-y-6">
              {/* Quick Actions */}
              <Card className="p-4">
                <h3 className="font-semibold text-gray-900 mb-4">Quick Actions</h3>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" size="sm" className="justify-start" onClick={() => setShowModal({ type: 'time-clock' })}>
                    <Icon name="clock" className="mr-2 text-brand-500" /> Time Clock
                  </Button>
                  <Button variant="secondary" size="sm" className="justify-start" onClick={() => setShowModal({ type: 'equipment-checkin' })}>
                    <Icon name="clipboard-check" className="mr-2 text-brand-500" /> Check-In
                  </Button>
                  <Button variant="secondary" size="sm" className="justify-start" onClick={() => setShowModal({ type: 'daily-report' })}>
                    <Icon name="file-lines" className="mr-2 text-brand-500" /> Daily Report
                  </Button>
                  <Button variant="secondary" size="sm" className="justify-start" onClick={() => setShowModal({ type: 'work-order' })}>
                    <Icon name="wrench" className="mr-2 text-brand-500" /> Work Order
                  </Button>
                  <Button variant="secondary" size="sm" className="justify-start col-span-2" onClick={() => setShowModal({ type: 'safety' })}>
                    <Icon name="shield-halved" className="mr-2 text-brand-500" /> Safety Sign-Off
                  </Button>
                </div>
              </Card>

              {/* Alerts */}
              <Card className="p-4">
                <h3 className="font-semibold text-gray-900 mb-4">
                  <Icon name="triangle-exclamation" className="mr-2 text-yellow-500" />
                  Alerts
                </h3>
                <div className="space-y-3">
                  {upcomingMaintenance.map(eq => (
                    <div key={eq.id} className="flex items-start gap-3 p-2 bg-yellow-50 rounded-lg">
                      <Icon name="wrench" className="text-yellow-600 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">{eq.name}</p>
                        <p className="text-xs text-gray-600">Service due in {eq.nextService - eq.hours} hours</p>
                      </div>
                    </div>
                  ))}
                  {expiringCerts.map((cert, i) => (
                    <div key={i} className="flex items-start gap-3 p-2 bg-red-50 rounded-lg">
                      <Icon name="id-card" className="text-red-600 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">{cert.employee}</p>
                        <p className="text-xs text-gray-600">{cert.name} expires {formatDate(cert.expires)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Weather Widget */}
              <Card className="p-4">
                <h3 className="font-semibold text-gray-900 mb-4">
                  <Icon name="cloud-sun" className="mr-2 text-blue-500" />
                  Weather - Cincinnati
                </h3>
                <div className="text-center mb-4">
                  <div className="flex items-center justify-center gap-4">
                    <Icon name="sun" className="text-yellow-500 text-4xl" />
                    <div>
                      <p className="text-4xl font-bold text-gray-900">47°F</p>
                      <p className="text-sm text-gray-500">Partly Cloudy</p>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center text-xs">
                  {[
                    { day: 'Fri', icon: 'sun', high: 52, low: 38 },
                    { day: 'Sat', icon: 'cloud', high: 48, low: 35 },
                    { day: 'Sun', icon: 'cloud-rain', high: 44, low: 32, alert: true },
                    { day: 'Mon', icon: 'sun', high: 50, low: 36 },
                  ].map((d, i) => (
                    <div key={i} className={`p-2 rounded-lg ${d.alert ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50'}`}>
                      <p className="font-medium text-gray-700">{d.day}</p>
                      <Icon name={d.icon} className={`my-2 ${d.icon === 'cloud-rain' ? 'text-blue-500' : d.icon === 'sun' ? 'text-yellow-500' : 'text-gray-400'}`} />
                      <p className="text-gray-900">{d.high}°</p>
                      <p className="text-gray-400">{d.low}°</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 p-2 bg-blue-50 rounded-lg flex items-center gap-2">
                  <Icon name="droplet" className="text-blue-500" />
                  <span className="text-xs text-blue-800">Rain expected Sunday - plan accordingly</span>
                </div>
              </Card>
            </div>
          </div>

          {/* Equipment Map & Status */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Equipment Location Map - Real Leaflet Map */}
            <Card className="p-4">
              <h3 className="font-semibold text-gray-900 mb-4">
                <Icon name="map-location-dot" className="mr-2 text-brand-500" />
                Equipment Locations - Cincinnati Area
              </h3>
              <LeafletMap equipment={equipment} jobs={jobs} />
            </Card>

            {/* Work Orders */}
            <Card className="p-0 overflow-hidden">
              <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">Open Work Orders</h3>
                <Button variant="ghost" size="sm" onClick={() => setCurrentView('maintenance')}>
                  View All <Icon name="arrow-right" className="ml-1" />
                </Button>
              </div>
              <div className="divide-y divide-gray-100">
                {workOrders.filter(w => w.status !== 'completed').slice(0, 4).map(wo => {
                  const eq = equipment.find(e => e.id === wo.equipmentId);
                  const assignee = employees.find(e => e.id === wo.assignedTo);
                  return (
                    <div key={wo.id} className="p-4 hover:bg-gray-50">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <Icon name={wo.priority === 'high' ? 'circle-exclamation' : 'circle'} className={getPriorityColor(wo.priority)} />
                            <span className="font-medium text-gray-900">{wo.title}</span>
                          </div>
                          <p className="text-sm text-gray-500 mt-1">{eq?.name}</p>
                        </div>
                        <Badge className={getStatusColor(wo.status)}>{wo.status}</Badge>
                      </div>
                      <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
                        <span><Icon name="user" className="mr-1" />{assignee?.name}</span>
                        <span>Due {formatDate(wo.dueDate)}</span>
                      </div>
                    </div>
                  );
                })}
                {workOrders.filter(w => w.status !== 'completed').length === 0 && (
                  <div className="p-4">
                    <EmptyState testId="dashboard-workorders-empty">No open work orders.</EmptyState>
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>
      );
}
